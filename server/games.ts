import { toBase64Url } from "./auth";
import type { D1Database } from "./types";

/*
	The 8 LAB games, unlocked one at a time by inviting friends.

	- Every account has one invitation: a link (token) to share and a short
	  code shown only to its owner. A friend opens the link, signs up, and
	  types the code the inviter reads to them.
	- Only new accounts (created in the last NEW_ACCOUNT_HOURS) can confirm,
	  and each account confirms once in its life — so every game needs
	  FRIENDS_PER_GAME people who never helped anyone before.
	- Progress is derived from the confirmations: a game is unlocked when it
	  and every game before it have enough valid (non-voided) ones.
*/

export const SLOTS = 8;
export const FRIENDS_PER_GAME = 3;
export const NEW_ACCOUNT_HOURS = 24;

// No 0/O or 1/I/L, so a code read out loud can't be misheard.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export function newCode(): string {
	let code = "";
	while (code.length < CODE_LENGTH) {
		for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
			// Reject the top of the byte range so every character is equally likely.
			if (byte < 248 && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
		}
	}
	return code;
}

export const normalizeCode = (value: unknown) =>
	String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

export async function getOrCreateInvite(db: D1Database, userId: number): Promise<{ token: string; code: string }> {
	const existing = await db.prepare(`SELECT token, code FROM invites WHERE user_id = ?`).bind(userId).first<{ token: string; code: string }>();
	if (existing) return existing;

	const invite = { token: toBase64Url(crypto.getRandomValues(new Uint8Array(18))), code: newCode() };
	await db.prepare(`INSERT OR IGNORE INTO invites (user_id, token, code) VALUES (?, ?, ?)`).bind(userId, invite.token, invite.code).run();
	// Another request may have created it a moment earlier.
	return (await db.prepare(`SELECT token, code FROM invites WHERE user_id = ?`).bind(userId).first<{ token: string; code: string }>()) ?? invite;
}

export type Progress = {
	counts: number[]; // valid confirmations per slot (index 0 = slot 1)
	unlocked: number; // how many games, from the first, are unlocked
	current: number | null; // the slot being unlocked now (null when all are)
};

export function progressFrom(counts: number[]): Progress {
	let unlocked = 0;
	while (unlocked < SLOTS && counts[unlocked] >= FRIENDS_PER_GAME) unlocked++;
	return { counts, unlocked, current: unlocked < SLOTS ? unlocked + 1 : null };
}

export async function getProgress(db: D1Database, userId: number): Promise<Progress> {
	const { results } = await db
		.prepare(`SELECT slot, COUNT(*) AS n FROM invite_confirmations WHERE inviter_id = ? AND voided = 0 GROUP BY slot`)
		.bind(userId)
		.all<{ slot: number; n: number }>();
	const counts = Array.from({ length: SLOTS }, () => 0);
	for (const row of results) if (row.slot >= 1 && row.slot <= SLOTS) counts[row.slot - 1] = row.n;
	return progressFrom(counts);
}

export type GameRow = { slot: number; title: string; description: string; icon: string; url: string; ready: number };

// All 8 slots, empty ones included.
export async function getGames(db: D1Database): Promise<GameRow[]> {
	const { results } = await db.prepare(`SELECT slot, title, description, icon, url, ready FROM games`).all<GameRow>();
	return Array.from({ length: SLOTS }, (_, i) => results.find((g) => g.slot === i + 1) ?? { slot: i + 1, title: "", description: "", icon: "", url: "", ready: 0 });
}

// What someone at a given point of their progress may see of each slot: the
// unlocked ones in full, the one being unlocked as a teaser, the rest hidden.
export function gamesFor(games: GameRow[], progress: Progress) {
	return games.map((g) => {
		const unlocked = g.slot <= progress.unlocked;
		const teaser = unlocked || g.slot === progress.current;
		return {
			slot: g.slot,
			state: unlocked ? "unlocked" : teaser ? "current" : "locked",
			title: teaser ? g.title : "",
			icon: teaser ? g.icon : "",
			description: unlocked ? g.description : "",
			ready: unlocked && Boolean(g.ready),
			url: unlocked && g.ready ? g.url : "",
		};
	});
}

// Has the friend used the same connection as the inviter recently? (A hint of
// someone inviting themselves; shown in the panel, not blocked.)
export async function sameNetwork(db: D1Database, inviterId: number, friendId: number, ip: string): Promise<boolean> {
	const row = await db
		.prepare(
			`SELECT 1 FROM user_events a
				WHERE a.user_id = ? AND a.at > datetime('now', '-30 days')
					AND (a.ip_hash = ? OR a.ip_hash IN (SELECT b.ip_hash FROM user_events b WHERE b.user_id = ?))
				LIMIT 1`
		)
		.bind(inviterId, ip, friendId)
		.first();
	return Boolean(row);
}

export const isSafeGameUrl = (url: string) => url === "" || /^https:\/\/[^\s]+$/i.test(url) || /^\/(?!\/)[^\s]*$/.test(url);

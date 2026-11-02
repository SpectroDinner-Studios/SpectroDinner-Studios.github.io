import { FRIENDS_PER_GAME, NEW_ACCOUNT_HOURS, SLOTS, gamesFor, getGames, getOrCreateInvite, getProgress, newCode, progressFrom } from "../../../server/games";
import { corsPreflight, json, readJsonObject, withCors } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import { type UserSession, logUserEvent, userIp } from "../../../server/users";

const RULES = { slots: SLOTS, friendsPerGame: FRIENDS_PER_GAME, newAccountHours: NEW_ACCOUNT_HOURS };

export const onRequestOptions: PagesHandler = async ({ request }) => corsPreflight(request);

// GET → the 8 slots as this visitor may see them. Signed in, also: progress,
// the invitation (link + code) and who has confirmed it.
export const onRequestGet: PagesHandler = async ({ request, env, data }) => {
	const db = env.DB!;
	const user = data.user as UserSession | null;
	const games = await getGames(db);

	if (!user) return withCors(request, json({ rules: RULES, games: gamesFor(games, progressFrom([])), me: null }));

	const [progress, invite, friends] = await Promise.all([
		getProgress(db, user.id),
		getOrCreateInvite(db, user.id),
		db
			.prepare(
				`SELECT c.slot, c.created_at, COALESCE(u.name, '') AS name FROM invite_confirmations c
					LEFT JOIN users u ON u.id = c.friend_id
					WHERE c.inviter_id = ? AND c.voided = 0 ORDER BY c.id`
			)
			.bind(user.id)
			.all<{ slot: number; created_at: string; name: string }>(),
	]);

	// Remember this connection (once a day) to spot friends on the same one.
	const ip = await userIp(request, env.SESSION_SECRET!);
	const seen = await db
		.prepare(`SELECT 1 FROM user_events WHERE user_id = ? AND ip_hash = ? AND at > datetime('now', '-1 day') LIMIT 1`)
		.bind(user.id, ip)
		.first();
	if (!seen) await logUserEvent(db, "games_view", ip, user.id);

	return json({
		rules: RULES,
		games: gamesFor(games, progress),
		me: {
			unlocked: progress.unlocked,
			current: progress.current,
			counts: progress.counts,
			code: invite.code,
			link: new URL(`/invitacion/?i=${invite.token}`, request.url).toString(),
			friends: friends.results.map((f) => ({ slot: f.slot, created_at: f.created_at, name: f.name.split(" ")[0] || "—" })),
		},
	});
};

// POST { action: "new-code" } → a fresh code (if the old one got around).
export const onRequestPost: PagesHandler = async ({ request, env, data }) => {
	const user = data.user as UserSession | null;
	if (!user) return json({ error: "unauthorized" }, 401);

	const body = await readJsonObject(request, 200);
	if (body?.action !== "new-code") return json({ error: "unknown_action" }, 400);

	await getOrCreateInvite(env.DB!, user.id);
	const code = newCode();
	await env.DB!.prepare(`UPDATE invites SET code = ? WHERE user_id = ?`).bind(code, user.id).run();
	return json({ ok: true, code });
};

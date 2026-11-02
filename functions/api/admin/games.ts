import { logAction } from "../../../server/db";
import { FRIENDS_PER_GAME, SLOTS, getGames, isSafeGameUrl, progressFrom } from "../../../server/games";
import { json, readJsonObject } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

// GET → the 8 slots, how many accounts unlocked each, and recent confirmations
// POST { action: "save", slot, title, description, icon, url, ready }
// POST { action: "void" | "restore", id } → a confirmation stops / starts counting
export const onRequestGet: PagesHandler = async ({ env }) => {
	const db = env.DB!;

	const [games, perSlot, confirmations, invites] = await Promise.all([
		getGames(db),
		db
			.prepare(`SELECT inviter_id, slot, COUNT(*) AS n FROM invite_confirmations WHERE voided = 0 GROUP BY inviter_id, slot`)
			.all<{ inviter_id: number; slot: number; n: number }>(),
		db
			.prepare(
				`SELECT c.id, c.slot, c.same_network, c.voided, c.created_at,
						i.name AS inviter_name, i.email AS inviter_email,
						f.name AS friend_name, f.email AS friend_email
					FROM invite_confirmations c
					LEFT JOIN users i ON i.id = c.inviter_id
					LEFT JOIN users f ON f.id = c.friend_id
					ORDER BY c.id DESC LIMIT 300`
			)
			.all(),
		db.prepare(`SELECT COUNT(*) AS n FROM invites`).first<{ n: number }>(),
	]);

	// How many accounts have each game unlocked.
	const byInviter = new Map<number, number[]>();
	for (const row of perSlot.results) {
		const counts = byInviter.get(row.inviter_id) ?? Array.from({ length: SLOTS }, () => 0);
		if (row.slot >= 1 && row.slot <= SLOTS) counts[row.slot - 1] = row.n;
		byInviter.set(row.inviter_id, counts);
	}
	const unlockedBy = Array.from({ length: SLOTS }, () => 0);
	for (const counts of byInviter.values()) {
		const { unlocked } = progressFrom(counts);
		for (let i = 0; i < unlocked; i++) unlockedBy[i]++;
	}

	return json({
		games: games.map((g, i) => ({ ...g, ready: Boolean(g.ready), unlockedBy: unlockedBy[i] })),
		confirmations: confirmations.results,
		invites: invites?.n ?? 0,
		friendsPerGame: FRIENDS_PER_GAME,
	});
};

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const body = await readJsonObject(request, 5000);
	const action = String(body?.action ?? "");

	if (action === "save") {
		const slot = Number(body?.slot);
		const title = String(body?.title ?? "").trim().slice(0, 60);
		const description = String(body?.description ?? "").trim().slice(0, 400);
		const icon = String(body?.icon ?? "").trim().slice(0, 8);
		const url = String(body?.url ?? "").trim().slice(0, 300);
		const ready = body?.ready === true;

		if (!Number.isInteger(slot) || slot < 1 || slot > SLOTS) return json({ error: "invalid_slot" }, 400);
		if (!isSafeGameUrl(url)) return json({ error: "invalid_url" }, 400);
		if (ready && (!title || !url)) return json({ error: "ready_needs_title_and_url" }, 400);

		await db
			.prepare(
				`INSERT INTO games (slot, title, description, icon, url, ready, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
					ON CONFLICT(slot) DO UPDATE SET title = excluded.title, description = excluded.description, icon = excluded.icon,
						url = excluded.url, ready = excluded.ready, updated_at = excluded.updated_at`
			)
			.bind(slot, title, description, icon, url, ready ? 1 : 0)
			.run();
		await logAction(db, "game-save", null, `Juego ${slot}${title ? ` (${title})` : ""}: guardado${ready ? ", listo para jugar" : ""}`);
		return json({ ok: true });
	}

	if (action === "void" || action === "restore") {
		const id = Number(body?.id);
		const row = Number.isInteger(id)
			? await db
					.prepare(
						`SELECT c.slot, i.name AS inviter, f.name AS friend FROM invite_confirmations c
							LEFT JOIN users i ON i.id = c.inviter_id LEFT JOIN users f ON f.id = c.friend_id WHERE c.id = ?`
					)
					.bind(id)
					.first<{ slot: number; inviter: string | null; friend: string | null }>()
			: null;
		if (!row) return json({ error: "not_found" }, 404);

		const voiding = action === "void";
		await db.prepare(`UPDATE invite_confirmations SET voided = ? WHERE id = ?`).bind(voiding ? 1 : 0, id).run();
		await logAction(
			db,
			voiding ? "invite-void" : "invite-restore",
			null,
			`Invitación de ${row.inviter ?? "cuenta eliminada"} confirmada por ${row.friend ?? "cuenta eliminada"} (juego ${row.slot}): ${voiding ? "anulada" : "restaurada"}`
		);
		return json({ ok: true });
	}

	return json({ error: "unknown_action" }, 400);
};

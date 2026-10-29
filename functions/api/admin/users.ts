import { logAction } from "../../../server/db";
import { json, readJsonObject } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import { createResetToken, deleteUserStatements } from "../../../server/users";

// GET → every account (never its password hash)
// POST { id, action: "reset-link" }        → one-time link (24 h) to set a new password
// POST { id, action: "disable" | "enable" } → disabling also signs it out everywhere
// POST { id, action: "delete" }            → the account and its tickets are erased
export const onRequestGet: PagesHandler = async ({ env }) => {
	const { results } = await env
		.DB!.prepare(
			`SELECT u.id, u.email, u.name, u.created_at, u.last_login, u.disabled,
					(SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id) AS tickets
				FROM users u ORDER BY u.created_at DESC LIMIT 500`
		)
		.all();
	return json({ users: results });
};

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const body = await readJsonObject(request, 1000);
	const id = Number(body?.id);
	const action = String(body?.action ?? "");

	const user = Number.isInteger(id)
		? await db.prepare(`SELECT id, name, email FROM users WHERE id = ?`).bind(id).first<{ id: number; name: string; email: string }>()
		: null;
	if (!user) return json({ error: "not_found" }, 404);

	const label = `Cuenta ${user.name} <${user.email}>`;

	if (action === "reset-link") {
		const token = await createResetToken(db, env.SESSION_SECRET!, id);
		await logAction(db, "user-reset", null, `${label}: enlace para cambiar la contraseña`);
		return json({ ok: true, url: new URL(`/cuenta/restablecer/?token=${token}`, request.url).toString() });
	}

	if (action === "disable" || action === "enable") {
		const disabling = action === "disable";
		await db.batch([
			db.prepare(`UPDATE users SET disabled = ? WHERE id = ?`).bind(disabling ? 1 : 0, id),
			...(disabling ? [db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(id)] : []),
		]);
		await logAction(db, disabling ? "user-disable" : "user-enable", null, `${label}: ${disabling ? "desactivada" : "activada"}`);
		return json({ ok: true });
	}

	if (action === "delete") {
		await db.batch(deleteUserStatements(db, id));
		await logAction(db, "user-delete", null, `${label}: eliminada`);
		return json({ ok: true });
	}

	return json({ error: "unknown_action" }, 400);
};

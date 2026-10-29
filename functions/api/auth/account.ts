import { json, readJsonObject, withCookies } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import {
	cleanName,
	clearUserCookies,
	deleteUserStatements,
	getUser,
	hashPassword,
	passwordProblem,
	verifyPassword,
} from "../../../server/users";

// POST { action: "update-name", name }
// POST { action: "change-password", current, password } → other devices are signed out
// POST { action: "delete", password }                    → the account and its tickets are erased
export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const user = await getUser(request, db, env.SESSION_SECRET!);
	if (!user) return json({ error: "unauthorized" }, 401);

	const body = await readJsonObject(request, 2000);
	const action = String(body?.action ?? "");

	if (action === "update-name") {
		const name = cleanName(body?.name);
		if (name.length < 2) return json({ error: "name_invalid" }, 400);
		await db.prepare(`UPDATE users SET name = ? WHERE id = ?`).bind(name, user.id).run();
		return json({ ok: true, name });
	}

	// Everything below needs the current password again.
	const stored = await db.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(user.id).first<{ password_hash: string }>();
	const current = String((action === "delete" ? body?.password : body?.current) ?? "").slice(0, 200);
	if (!stored || !(await verifyPassword(current, stored.password_hash))) return json({ error: "wrong_password" }, 403);

	if (action === "change-password") {
		const password = String(body?.password ?? "");
		const problem = passwordProblem(password, user.email);
		if (problem) return json({ error: problem }, 400);

		await db.batch([
			db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(password), user.id),
			db.prepare(`DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?`).bind(user.id, user.token_hash),
		]);
		return json({ ok: true });
	}

	if (action === "delete") {
		await db.batch(deleteUserStatements(db, user.id));
		return withCookies(json({ ok: true }), clearUserCookies());
	}

	return json({ error: "unknown_action" }, 400);
};

import { json, readJsonObject, withCookies } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import { createUserSession, findResetUser, hashPassword, passwordProblem } from "../../../server/users";

// GET ?token=… → is this "set a new password" link still valid?
export const onRequestGet: PagesHandler = async ({ request, env }) => {
	const token = new URL(request.url).searchParams.get("token") ?? "";
	return json({ valid: (await findResetUser(env.DB!, env.SESSION_SECRET!, token)) !== null });
};

// POST { token, password } → sets it, signs out every device and signs in here.
export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const secret = env.SESSION_SECRET!;

	const body = await readJsonObject(request, 2000);
	const userId = await findResetUser(db, secret, String(body?.token ?? ""));
	if (userId === null) return json({ error: "invalid_token" }, 400);

	const user = await db.prepare(`SELECT email FROM users WHERE id = ? AND disabled = 0`).bind(userId).first<{ email: string }>();
	if (!user) return json({ error: "invalid_token" }, 400);

	const password = String(body?.password ?? "");
	const problem = passwordProblem(password, user.email);
	if (problem) return json({ error: problem }, 400);

	await db.batch([
		db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(password), userId),
		db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(userId),
		db.prepare(`DELETE FROM password_resets WHERE user_id = ?`).bind(userId),
	]);

	return withCookies(json({ ok: true }), await createUserSession(db, secret, userId, request));
};

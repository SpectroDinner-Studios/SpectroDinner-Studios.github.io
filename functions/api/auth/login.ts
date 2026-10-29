import { json, readJsonObject, withCookies } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import {
	burnPasswordCheck,
	countEvents,
	createUserSession,
	logUserEvent,
	normalizeEmail,
	pruneUserTables,
	userIp,
	verifyPassword,
} from "../../../server/users";

const LOCK_MINUTES = 15;
const MAX_FAILS_PER_IP = 10;
const MAX_FAILS_PER_ACCOUNT = 8;

// POST { email, password } → signs in. Wrong email and wrong password get the
// same answer (and take as long), so nobody can tell which accounts exist.
export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const secret = env.SESSION_SECRET!;

	const body = await readJsonObject(request, 2000);
	const email = normalizeEmail(body?.email);
	const password = String(body?.password ?? "").slice(0, 200);

	const ip = await userIp(request, secret);
	const locked = () => json({ error: "locked", retryMinutes: LOCK_MINUTES }, 429, { "Retry-After": String(LOCK_MINUTES * 60) });

	if ((await countEvents(db, "login_fail", LOCK_MINUTES, { ip })) >= MAX_FAILS_PER_IP) return locked();

	const user = email
		? await db
				.prepare(`SELECT id, name, email, password_hash, disabled FROM users WHERE email = ?`)
				.bind(email)
				.first<{ id: number; name: string; email: string; password_hash: string; disabled: number }>()
		: null;

	if (user && (await countEvents(db, "login_fail", LOCK_MINUTES, { userId: user.id })) >= MAX_FAILS_PER_ACCOUNT) {
		return locked();
	}

	const ok = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordCheck(password), false);

	if (!user || !ok) {
		await logUserEvent(db, "login_fail", ip, user?.id ?? null);
		return json({ error: "invalid_credentials" }, 401);
	}

	if (user.disabled) return json({ error: "account_disabled" }, 403);

	await logUserEvent(db, "login_ok", ip, user.id);
	await pruneUserTables(db);

	return withCookies(
		json({ ok: true, user: { id: user.id, name: user.name, email: user.email } }),
		await createUserSession(db, secret, user.id, request)
	);
};

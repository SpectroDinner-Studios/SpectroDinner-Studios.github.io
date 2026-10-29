import { createSession, ipHash, logEvent, passwordMatches, pruneAuthTables } from "../../../server/auth";
import { json, readJsonObject } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

const MAX_FAILS_PER_IP = 5; // per 15 minutes, counted since that IP's last good login
const MAX_FAILS_GLOBAL = 30; // per hour, from anywhere — stops distributed guessing
const LOCK_MINUTES = 15;

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	// The middleware guarantees DB and both secrets exist before we get here.
	const db = env.DB!;
	const secret = env.SESSION_SECRET!;
	const ip = await ipHash(request, secret);

	const [perIp, global] = await Promise.all([
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM admin_events
					WHERE kind = 'login_fail' AND ip_hash = ?
						AND at > datetime('now', ?)
						AND at > COALESCE((SELECT MAX(at) FROM admin_events WHERE kind = 'login_ok' AND ip_hash = ?), '')`
			)
			.bind(ip, `-${LOCK_MINUTES} minutes`, ip)
			.first<{ n: number }>(),
		db
			.prepare(`SELECT COUNT(*) AS n FROM admin_events WHERE kind = 'login_fail' AND at > datetime('now', '-1 hour')`)
			.first<{ n: number }>(),
	]);

	const fails = perIp?.n ?? 0;

	if (fails >= MAX_FAILS_PER_IP || (global?.n ?? 0) >= MAX_FAILS_GLOBAL) {
		return json({ error: "locked", retryMinutes: LOCK_MINUTES }, 429, { "Retry-After": String(LOCK_MINUTES * 60) });
	}

	const body = await readJsonObject(request, 1000);
	const password = typeof body?.password === "string" ? body.password : "";

	if (!password || !(await passwordMatches(password, env.ADMIN_PASSWORD!))) {
		await logEvent(db, "login_fail", request, secret);
		// Slow down guessing a little more.
		await new Promise((resolve) => setTimeout(resolve, 800));
		return json({ error: "invalid_credentials", remaining: Math.max(0, MAX_FAILS_PER_IP - fails - 1) }, 401);
	}

	await logEvent(db, "login_ok", request, secret);
	await pruneAuthTables(db);

	return json({ ok: true }, 200, { "Set-Cookie": await createSession(db, secret, request) });
};

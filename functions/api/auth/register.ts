import { json, readJsonObject, withCookies } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import {
	EMAIL_RE,
	cleanName,
	countEvents,
	createUserSession,
	hashPassword,
	logUserEvent,
	normalizeEmail,
	passwordProblem,
	userIp,
} from "../../../server/users";

const MAX_PER_HOUR = 5; // new accounts per IP

// POST { name, email, password, accept } → creates the account and signs in.
export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const secret = env.SESSION_SECRET!;

	const body = await readJsonObject(request, 2000);
	if (!body || body.website) return json({ error: "invalid_body" }, 400); // `website` is the honeypot

	const name = cleanName(body.name);
	const email = normalizeEmail(body.email);
	const password = String(body.password ?? "");

	if (name.length < 2) return json({ error: "name_invalid" }, 400);
	if (!EMAIL_RE.test(email)) return json({ error: "email_invalid" }, 400);
	const problem = passwordProblem(password, email);
	if (problem) return json({ error: problem }, 400);
	if (body.accept !== true) return json({ error: "terms_required" }, 400);

	const ip = await userIp(request, secret);
	if ((await countEvents(db, "register", 60, { ip })) >= MAX_PER_HOUR) return json({ error: "rate_limited" }, 429);

	if (await db.prepare(`SELECT 1 FROM users WHERE email = ?`).bind(email).first()) {
		return json({ error: "email_taken" }, 409);
	}

	let userId: number;
	try {
		const { meta } = await db
			.prepare(`INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)`)
			.bind(email, name, await hashPassword(password))
			.run();
		userId = Number(meta.last_row_id);
	} catch {
		return json({ error: "email_taken" }, 409); // registered a moment ago
	}

	await logUserEvent(db, "register", ip, userId);

	return withCookies(
		json({ ok: true, user: { id: userId, name, email } }, 201),
		await createUserSession(db, secret, userId, request)
	);
};

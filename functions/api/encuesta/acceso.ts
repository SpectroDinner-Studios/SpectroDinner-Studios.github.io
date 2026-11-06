import { timingSafeEqual } from "../../../server/auth";
import { json, readJsonObject, withCookies } from "../../../server/http";
import {
	activeGroup,
	consumePassword,
	currentPassword,
	newSessionToken,
	normalizePassword,
	pruneSurveySessions,
	surveyCookie,
	surveySession,
	wasIssued,
} from "../../../server/survey";
import type { PagesHandler } from "../../../server/types";
import { countEvents, logUserEvent, userIp } from "../../../server/users";

// Generous: a whole class usually shares one IP. Only passwords that never
// existed count, so people racing for the same one aren't penalised.
const MAX_WRONG_PER_IP = 100;
const WINDOW_MINUTES = 15;

// GET → does this browser already have a session open?
export const onRequestGet: PagesHandler = async ({ request, env }) =>
	json({ session: Boolean(await surveySession(request, env.DB!, env.SESSION_SECRET!)) });

// POST { password } → consumes it and opens a temporary session.
export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const secret = env.SESSION_SECRET!;

	// Already inside (a second tab, a double click): don't waste a password.
	if (await surveySession(request, db, secret)) return json({ ok: true });

	const ip = await userIp(request, secret);
	if ((await countEvents(db, "survey_fail", WINDOW_MINUTES, { ip })) >= MAX_WRONG_PER_IP) {
		return json({ error: "rate_limited" }, 429);
	}

	const body = await readJsonObject(request, 200);
	const password = normalizePassword(body?.password);
	const group = await activeGroup(db);
	if (!group || !password) return json({ error: "invalid_password" }, 401);

	if (!timingSafeEqual(password, await currentPassword(group, secret))) {
		if (await wasIssued(db, password, secret)) return json({ error: "password_used" }, 409);

		await logUserEvent(db, "survey_fail", ip);
		await db.prepare(`DELETE FROM user_events WHERE kind = 'survey_fail' AND at <= datetime('now', '-1 day')`).run();
		return json({ error: "invalid_password" }, 401);
	}

	const { token, tokenHash } = await newSessionToken(secret);
	if (!(await consumePassword(db, secret, group, tokenHash))) return json({ error: "password_used" }, 409);

	await pruneSurveySessions(db);

	return withCookies(json({ ok: true }), [surveyCookie(token)]);
};

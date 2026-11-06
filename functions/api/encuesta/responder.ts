import { json, readJsonObject, withCookies } from "../../../server/http";
import { CHOICES, IMPROVEMENT_MAX, REASON_MAX, REASON_MIN, clearSurveyCookie, saveResponse, surveySession } from "../../../server/survey";
import { cleanText } from "../../../server/tickets";
import type { PagesHandler } from "../../../server/types";

// POST { choice, reason, improvement } → stores the answers and ends the
// session. The course and group come from the session, never from the browser.
export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;

	const tokenHash = await surveySession(request, db, env.SESSION_SECRET!);
	if (!tokenHash) return json({ error: "session_expired" }, 401);

	const body = await readJsonObject(request, 6000);
	const choice = String(body?.choice ?? "");
	const reason = cleanText(body?.reason, REASON_MAX + 1);
	const improvement = cleanText(body?.improvement, IMPROVEMENT_MAX + 1);

	if (!CHOICES.includes(choice)) return json({ error: "choice_invalid" }, 400);
	if (reason.length < REASON_MIN || reason.length > REASON_MAX) return json({ error: "reason_invalid" }, 400);
	if (improvement.length > IMPROVEMENT_MAX) return json({ error: "improvement_invalid" }, 400);

	// False if a second send got here first: the session is already spent.
	if (!(await saveResponse(db, tokenHash, { choice, reason, improvement }))) {
		return json({ error: "session_expired" }, 401);
	}

	return withCookies(json({ ok: true }), [clearSurveyCookie()]);
};

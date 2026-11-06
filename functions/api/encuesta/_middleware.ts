import { ensureSchema } from "../../../server/db";
import { PRIVATE_HEADERS, crossOriginWrite, json, withHeaders } from "../../../server/http";
import { ensureSurveySchema } from "../../../server/survey";
import type { PagesHandler } from "../../../server/types";

// Guards every /api/encuesta/* route: backend configured, same-origin writes
// only, and replies that are never cached or indexed.
export const onRequest: PagesHandler = async ({ request, env, next }) => {
	if (!env.DB || !env.SESSION_SECRET) return json({ error: "unavailable" }, 503, PRIVATE_HEADERS);
	if (crossOriginWrite(request)) return json({ error: "forbidden" }, 403, PRIVATE_HEADERS);

	await ensureSchema(env.DB);
	await ensureSurveySchema(env.DB);

	return withHeaders(await next(), PRIVATE_HEADERS);
};

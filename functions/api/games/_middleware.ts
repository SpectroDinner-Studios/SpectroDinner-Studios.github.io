import { ensureSchema } from "../../../server/db";
import { PRIVATE_HEADERS, crossOriginWrite, json, withHeaders } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import { getUser } from "../../../server/users";

// Guards every /api/games/* route: same-origin writes, never cached. The
// signed-in account (if any) is in data.user; each route decides if it needs one.
export const onRequest: PagesHandler = async ({ request, env, next, data }) => {
	if (!env.DB || !env.SESSION_SECRET) return json({ error: "unavailable" }, 503, PRIVATE_HEADERS);
	if (crossOriginWrite(request)) return json({ error: "forbidden" }, 403, PRIVATE_HEADERS);

	await ensureSchema(env.DB);
	data.user = await getUser(request, env.DB, env.SESSION_SECRET);

	return withHeaders(await next(), PRIVATE_HEADERS);
};

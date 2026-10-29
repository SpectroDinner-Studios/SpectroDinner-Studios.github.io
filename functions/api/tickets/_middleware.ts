import { ensureSchema } from "../../../server/db";
import { PRIVATE_HEADERS, crossOriginWrite, json, withHeaders } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import { getUser } from "../../../server/users";

// Guards every /api/tickets/* route: same-origin writes, a signed-in account
// (in data.user), and replies that are never cached or indexed.
export const onRequest: PagesHandler = async ({ request, env, next, data }) => {
	if (!env.DB || !env.SESSION_SECRET) return json({ error: "unavailable" }, 503, PRIVATE_HEADERS);
	if (crossOriginWrite(request)) return json({ error: "forbidden" }, 403, PRIVATE_HEADERS);

	await ensureSchema(env.DB);

	const user = await getUser(request, env.DB, env.SESSION_SECRET);
	if (!user) return json({ error: "unauthorized" }, 401, PRIVATE_HEADERS);
	data.user = user;

	return withHeaders(await next(), PRIVATE_HEADERS);
};

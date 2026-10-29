import { getSession } from "../../../server/auth";
import { ensureSchema } from "../../../server/db";
import { PRIVATE_HEADERS, json, withHeaders } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

// Guards every /api/admin/* route: backend configured, same-origin writes and a
// valid server-side session (except for the login route itself). Every reply
// carries the private headers so nothing is cached, indexed or archived.
export const onRequest: PagesHandler = async (context) => {
	const { request, env, next, data } = context;

	if (!env.DB || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
		return json({ error: "unavailable" }, 503, PRIVATE_HEADERS);
	}

	const url = new URL(request.url);

	if (request.method !== "GET") {
		const origin = request.headers.get("Origin");
		if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403, PRIVATE_HEADERS);
	}

	await ensureSchema(env.DB);

	if (url.pathname.replace(/\/$/, "") !== "/api/admin/login") {
		const session = await getSession(request, env.DB, env.SESSION_SECRET);
		if (!session) return json({ error: "unauthorized" }, 401, PRIVATE_HEADERS);
		data.session = session;
	}

	return withHeaders(await next(), PRIVATE_HEADERS);
};

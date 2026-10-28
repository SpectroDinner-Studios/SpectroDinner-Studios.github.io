import { isAuthenticated } from "../../../server/auth";
import { json } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

// Guards every /api/admin/* route: backend configured, same-origin writes,
// and a valid session (except for the login route itself).
export const onRequest: PagesHandler = async ({ request, env, next }) => {
	if (!env.DB || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
		return json({ error: "backend_not_configured" }, 503);
	}

	const url = new URL(request.url);

	if (request.method !== "GET") {
		const origin = request.headers.get("Origin");
		if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
	}

	if (url.pathname.replace(/\/$/, "") === "/api/admin/login") return next();

	if (!(await isAuthenticated(request, env.SESSION_SECRET))) {
		return json({ error: "unauthorized" }, 401);
	}

	return next();
};

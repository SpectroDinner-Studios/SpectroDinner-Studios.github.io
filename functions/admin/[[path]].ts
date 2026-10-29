import { getSession } from "../../server/auth";
import { ensureSchema } from "../../server/db";
import { PRIVATE_HEADERS, withHeaders } from "../../server/http";
import type { PagesHandler } from "../../server/types";

// Gatekeeper for /admin and everything below it. The panel's HTML (and the
// script inlined in it) is only handed out after a valid server-side session
// is found; anyone else — browser, crawler or AI — just gets a redirect to the
// public login page and never sees a single byte of the panel.
export const onRequest: PagesHandler = async ({ request, env, next }) => {
	const login = new URL("/acceso/", request.url);

	if (!env.DB || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
		return Response.redirect(login.toString(), 302);
	}

	await ensureSchema(env.DB);

	if (!(await getSession(request, env.DB, env.SESSION_SECRET))) {
		return withHeaders(Response.redirect(login.toString(), 302), PRIVATE_HEADERS);
	}

	return withHeaders(await next(), PRIVATE_HEADERS);
};

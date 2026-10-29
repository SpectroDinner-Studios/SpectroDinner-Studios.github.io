import { json, withCookies } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import { clearUserCookies, destroyUserSession } from "../../../server/users";

// POST → ends this browser's session, on the server too.
export const onRequestPost: PagesHandler = async ({ request, env }) => {
	await destroyUserSession(request, env.DB!, env.SESSION_SECRET!);
	return withCookies(json({ ok: true }), clearUserCookies());
};

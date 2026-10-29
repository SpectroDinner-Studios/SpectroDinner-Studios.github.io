import { clearSessionCookie, destroySession, logEvent } from "../../../server/auth";
import { json } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	await destroySession(request, env.DB!, env.SESSION_SECRET!);
	await logEvent(env.DB!, "logout", request, env.SESSION_SECRET!);
	return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
};

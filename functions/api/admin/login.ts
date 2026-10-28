import { createSessionCookie, timingSafeEqual } from "../../../server/auth";
import { json, readJsonObject } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const body = await readJsonObject(request, 1000);
	const password = typeof body?.password === "string" ? body.password : "";

	// The middleware guarantees both secrets exist before we get here.
	if (!password || !timingSafeEqual(password, env.ADMIN_PASSWORD as string)) {
		// Slow down password guessing a little.
		await new Promise((resolve) => setTimeout(resolve, 700));
		return json({ error: "invalid_credentials" }, 401);
	}

	return json({ ok: true }, 200, {
		"Set-Cookie": await createSessionCookie(env.SESSION_SECRET as string),
	});
};

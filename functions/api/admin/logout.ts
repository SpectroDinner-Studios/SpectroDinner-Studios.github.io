import { clearSessionCookie } from "../../../server/auth";
import { json } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

export const onRequestPost: PagesHandler = () =>
	json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });

import { json } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

// Reaching this handler means the middleware accepted the session cookie.
export const onRequestGet: PagesHandler = () => json({ ok: true });

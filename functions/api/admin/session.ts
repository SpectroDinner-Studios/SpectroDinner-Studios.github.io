import type { Session } from "../../../server/auth";
import { json } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

// Current session + the login before it, so the owner can spot unexpected access.
export const onRequestGet: PagesHandler = async ({ env, data }) => {
	const session = data.session as Session;

	const previous = await env
		.DB!.prepare(
			`SELECT at, user_agent FROM admin_events
				WHERE kind = 'login_ok' AND at < ?
				ORDER BY at DESC LIMIT 1`
		)
		.bind(session.created_at)
		.first<{ at: string; user_agent: string }>();

	return json({
		ok: true,
		session: { created_at: session.created_at, expires_at: session.expires_at },
		previousLogin: previous,
	});
};

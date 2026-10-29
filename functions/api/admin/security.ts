import { clearSessionCookie, logEvent, type Session } from "../../../server/auth";
import { json, readJsonObject } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

// GET  → open sessions and the recent access log
// POST { action: "revoke-others" | "revoke-all" } → close sessions
export const onRequestGet: PagesHandler = async ({ env, data }) => {
	const current = (data.session as Session).token_hash;

	const [sessions, events] = await Promise.all([
		env
			.DB!.prepare(
				`SELECT token_hash, created_at, last_seen, expires_at, user_agent FROM admin_sessions
					WHERE expires_at > datetime('now') ORDER BY last_seen DESC`
			)
			.all<Session & { user_agent: string }>(),
		env
			.DB!.prepare(`SELECT at, kind, user_agent FROM admin_events ORDER BY id DESC LIMIT 40`)
			.all<{ at: string; kind: string; user_agent: string }>(),
	]);

	return json({
		// Never expose token hashes, only whether a row is this browser's session.
		sessions: sessions.results.map(({ token_hash, ...rest }) => ({ ...rest, current: token_hash === current })),
		events: events.results,
	});
};

export const onRequestPost: PagesHandler = async ({ request, env, data }) => {
	const body = await readJsonObject(request, 200);
	const action = String(body?.action ?? "");
	const current = (data.session as Session).token_hash;

	if (action === "revoke-others") {
		await env.DB!.prepare(`DELETE FROM admin_sessions WHERE token_hash != ?`).bind(current).run();
		await logEvent(env.DB!, "revoke_others", request, env.SESSION_SECRET!);
		return json({ ok: true });
	}

	if (action === "revoke-all") {
		await env.DB!.prepare(`DELETE FROM admin_sessions`).run();
		await logEvent(env.DB!, "revoke_all", request, env.SESSION_SECRET!);
		return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
	}

	return json({ error: "unknown_action" }, 400);
};

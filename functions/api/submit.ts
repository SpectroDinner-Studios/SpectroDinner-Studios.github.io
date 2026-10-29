import { sha256 } from "../../server/auth";
import { ensureSchema } from "../../server/db";
import { validateSubmission } from "../../server/forms";
import { json, readJsonObject } from "../../server/http";
import type { PagesHandler } from "../../server/types";

// The Make scenario the forms have always posted to (email notifications).
const DEFAULT_MAKE_WEBHOOK = "https://hook.eu1.make.com/0k965b8ykue9xfa4wuny31jj5w5liinb";

const RATE_LIMIT = 5; // submissions per IP every 10 minutes
const REVIEW_LIMIT = 3; // reviews per IP per day (they go live instantly)

export const onRequestPost: PagesHandler = async ({ request, env, waitUntil }) => {
	// 503 tells the client to fall back to posting straight to Make.
	if (!env.DB) return json({ error: "backend_not_configured" }, 503);

	const payload = await readJsonObject(request);
	if (!payload) return json({ error: "invalid_body" }, 400);

	const result = validateSubmission(payload);
	if (!result.ok) return json({ error: result.error }, 400);

	await ensureSchema(env.DB);

	// Only a salted hash of the IP is stored, just for rate limiting.
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const ipHash = await sha256(`${ip}|${env.SESSION_SECRET ?? "spectrodinner"}`);

	const recent = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM submissions
			WHERE ip_hash = ? AND created_at > datetime('now', '-10 minutes')`
	)
		.bind(ipHash)
		.first<{ n: number }>();

	if ((recent?.n ?? 0) >= RATE_LIMIT) return json({ error: "rate_limited" }, 429);

	if (result.form === "review") {
		const reviews = await env.DB.prepare(
			`SELECT COUNT(*) AS n FROM submissions
				WHERE ip_hash = ? AND form = 'review' AND created_at > datetime('now', '-1 day')`
		)
			.bind(ipHash)
			.first<{ n: number }>();

		if ((reviews?.n ?? 0) >= REVIEW_LIMIT) return json({ error: "rate_limited" }, 429);
	}

	const { meta } = await env.DB.prepare(
		`INSERT INTO submissions (form, status, data, ip_hash) VALUES (?, ?, ?, ?)`
	)
		.bind(
			result.form,
			result.form === "review" ? "live" : "new",
			JSON.stringify(result.data),
			ipHash
		)
		.run();

	// Reviews are published straight away and moderated afterwards in /admin.
	// Keep feeding the Make scenario the same payload, without delaying the reply.
	waitUntil(
		fetch(env.MAKE_WEBHOOK_URL || DEFAULT_MAKE_WEBHOOK, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(result.data),
		}).catch(() => undefined)
	);

	// The id is shown to the visitor as their request number.
	return json({ ok: true, id: Number(meta.last_row_id) || undefined }, 201);
};

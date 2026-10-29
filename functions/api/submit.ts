import { sha256 } from "../../server/auth";
import { ensureSchema } from "../../server/db";
import { validateSubmission } from "../../server/forms";
import { corsPreflight, json, readJsonObject, withCors } from "../../server/http";
import { getSettings } from "../../server/settings";
import { createTicket, submissionSubject } from "../../server/tickets";
import { getUser } from "../../server/users";
import type { PagesHandler } from "../../server/types";

// The Make scenario the forms have always posted to (email notifications).
const DEFAULT_MAKE_WEBHOOK = "https://hook.eu1.make.com/0k965b8ykue9xfa4wuny31jj5w5liinb";

const RATE_LIMIT = 5; // submissions per IP every 10 minutes
const REVIEW_LIMIT = 3; // reviews per IP per day (they can go live instantly)

export const onRequestOptions: PagesHandler = async ({ request }) => corsPreflight(request);

export const onRequestPost: PagesHandler = async (context) => withCors(context.request, await submit(context));

const submit: PagesHandler = async ({ request, env, waitUntil }) => {
	// 503 tells the client to fall back to posting straight to Make.
	if (!env.DB) return json({ error: "backend_not_configured" }, 503);

	const payload = await readJsonObject(request);
	if (!payload) return json({ error: "invalid_body" }, 400);

	const result = validateSubmission(payload);
	if (!result.ok) return json({ error: result.error }, 400);

	await ensureSchema(env.DB);

	const settings = await getSettings(env.DB);
	if (result.form === "voluntariado" && !settings.volunteering_open) return json({ error: "closed" }, 403);

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

	// Reviews go live at once and are moderated afterwards in /admin, unless
	// instant publishing is switched off there (then they wait for approval).
	const published = result.form === "review" && settings.reviews_instant;

	const { meta } = await env.DB.prepare(
		`INSERT INTO submissions (form, status, data, ip_hash) VALUES (?, ?, ?, ?)`
	)
		.bind(
			result.form,
			result.form === "review" ? (published ? "live" : "pending") : "new",
			JSON.stringify(result.data),
			ipHash
		)
		.run();

	// Keep feeding the Make scenario the same payload, without delaying the reply.
	waitUntil(
		fetch(env.MAKE_WEBHOOK_URL || DEFAULT_MAKE_WEBHOOK, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(result.data),
		}).catch(() => undefined)
	);

	const id = Number(meta.last_row_id) || undefined;

	// Sent while signed in (only possible on this site, not from the GitHub
	// copy): open a ticket so the request can be followed from the account.
	let ticketId: number | undefined;
	if (id && result.form !== "review" && env.SESSION_SECRET) {
		const user = await getUser(request, env.DB, env.SESSION_SECRET);
		if (user) {
			ticketId = await createTicket(
				env.DB,
				{ userId: user.id, category: result.form, subject: submissionSubject(result.form, id, String(result.data.idioma ?? "es")), submissionId: id },
				{ author: "system", body: `submitted:${result.form}` }
			);
		}
	}

	// The id is shown to the visitor as their request number.
	return json(
		{ ok: true, id, ...(result.form === "review" ? { published } : {}), ...(ticketId ? { ticketId } : {}) },
		201
	);
};

import { json, readJsonObject } from "../../../server/http";
import { notifyTicket } from "../../../server/notify";
import { MAX_MESSAGE, MAX_SUBJECT, TICKET_CATEGORIES, cleanText, createTicket } from "../../../server/tickets";
import type { PagesHandler } from "../../../server/types";
import type { UserSession } from "../../../server/users";

const MAX_PER_DAY = 10; // new tickets per account

// GET → this account's tickets, newest activity first (with the status of the
// form behind each one, if any).
export const onRequestGet: PagesHandler = async ({ env, data }) => {
	const user = data.user as UserSession;

	const { results } = await env
		.DB!.prepare(
			`SELECT t.id, t.category, t.subject, t.status, t.created_at, t.updated_at, t.user_unread,
					t.submission_id, s.status AS submission_status
				FROM tickets t LEFT JOIN submissions s ON s.id = t.submission_id
				WHERE t.user_id = ? ORDER BY t.updated_at DESC, t.id DESC LIMIT 200`
		)
		.bind(user.id)
		.all();

	return json({ tickets: results });
};

// POST { category, subject, message } → opens a ticket.
export const onRequestPost: PagesHandler = async ({ request, env, data, waitUntil }) => {
	const db = env.DB!;
	const user = data.user as UserSession;

	const body = await readJsonObject(request, 20_000);
	const category = String(body?.category ?? "");
	const subject = cleanText(body?.subject, MAX_SUBJECT);
	const message = cleanText(body?.message, MAX_MESSAGE);

	if (!TICKET_CATEGORIES.includes(category)) return json({ error: "category_invalid" }, 400);
	if (subject.length < 3) return json({ error: "subject_short" }, 400);
	if (message.length < 2) return json({ error: "message_short" }, 400);

	const today = await db
		.prepare(`SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND submission_id IS NULL AND created_at > datetime('now', '-1 day')`)
		.bind(user.id)
		.first<{ n: number }>();
	if ((today?.n ?? 0) >= MAX_PER_DAY) return json({ error: "rate_limited" }, 429);

	const id = await createTicket(db, { userId: user.id, category, subject }, { author: "user", body: message });

	notifyTicket(env, waitUntil, request, { type: "ticket_opened", id, subject, category, name: user.name, email: user.email, message });

	return json({ ok: true, id }, 201);
};

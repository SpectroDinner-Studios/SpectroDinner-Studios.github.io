import { json, readJsonObject } from "../../../server/http";
import { notifyTicket } from "../../../server/notify";
import { MAX_MESSAGE, type TicketRow, addMessage, cleanText, getMessages, linkedSubmission } from "../../../server/tickets";
import type { D1Database, PagesHandler } from "../../../server/types";
import type { UserSession } from "../../../server/users";

const MAX_MESSAGES_PER_HOUR = 60;

// Only ever the signed-in account's own ticket.
const ownTicket = (db: D1Database, id: number, userId: number) =>
	db.prepare(`SELECT * FROM tickets WHERE id = ? AND user_id = ?`).bind(id, userId).first<TicketRow>();

// GET → the ticket, its messages and the status of the form behind it.
export const onRequestGet: PagesHandler = async ({ env, params, data }) => {
	const db = env.DB!;
	const user = data.user as UserSession;

	const ticket = await ownTicket(db, Number(params.id), user.id);
	if (!ticket) return json({ error: "not_found" }, 404);

	const [messages, submission] = await Promise.all([getMessages(db, ticket.id), linkedSubmission(db, ticket.submission_id)]);
	if (ticket.user_unread) await db.prepare(`UPDATE tickets SET user_unread = 0 WHERE id = ?`).bind(ticket.id).run();

	const { user_id: _owner, staff_unread: _staff, ...shown } = ticket;
	return json({
		ticket: shown,
		messages: messages.results,
		submission: submission && { status: submission.status, form: submission.form },
	});
};

// POST { action: "reply", body } | { action: "close" } | { action: "reopen" }
export const onRequestPost: PagesHandler = async ({ request, env, params, data, waitUntil }) => {
	const db = env.DB!;
	const user = data.user as UserSession;

	const ticket = await ownTicket(db, Number(params.id), user.id);
	if (!ticket) return json({ error: "not_found" }, 404);

	const body = await readJsonObject(request, 20_000);
	const action = String(body?.action ?? "");

	if (action === "reply") {
		const message = cleanText(body?.body, MAX_MESSAGE);
		if (message.length < 1) return json({ error: "message_short" }, 400);

		const recent = await db
			.prepare(
				`SELECT COUNT(*) AS n FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id
					WHERE t.user_id = ? AND m.author = 'user' AND m.created_at > datetime('now', '-1 hour')`
			)
			.bind(user.id)
			.first<{ n: number }>();
		if ((recent?.n ?? 0) >= MAX_MESSAGES_PER_HOUR) return json({ error: "rate_limited" }, 429);

		await addMessage(db, ticket.id, "user", message); // also reopens a closed ticket
		notifyTicket(env, waitUntil, request, {
			type: "ticket_reply", id: ticket.id, subject: ticket.subject, category: ticket.category, name: user.name, email: user.email, message,
		});
		return json({ ok: true });
	}

	if (action === "close" || action === "reopen") {
		const closing = action === "close";
		await db.batch([
			db.prepare(`INSERT INTO ticket_messages (ticket_id, author, body) VALUES (?, 'system', ?)`).bind(ticket.id, closing ? "closed:user" : "reopened:user"),
			db
				.prepare(`UPDATE tickets SET status = ?, staff_unread = ?, updated_at = datetime('now') WHERE id = ?`)
				.bind(closing ? "closed" : "open", closing ? ticket.staff_unread : 1, ticket.id),
		]);
		return json({ ok: true });
	}

	return json({ error: "unknown_action" }, 400);
};

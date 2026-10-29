import { logAction } from "../../../server/db";
import { json, readJsonObject } from "../../../server/http";
import { MAX_MESSAGE, type TicketRow, addMessage, cleanText, getMessages } from "../../../server/tickets";
import type { PagesHandler } from "../../../server/types";

// GET               → every ticket (unread first), with its account and last message
// GET ?id=7         → one ticket: account, messages and the form behind it
// POST { id, action: "reply", body, close? } | { id, action: "close" | "reopen" }
export const onRequestGet: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const id = Number(new URL(request.url).searchParams.get("id"));

	if (!id) {
		const { results } = await db
			.prepare(
				`SELECT t.id, t.category, t.subject, t.status, t.created_at, t.updated_at, t.staff_unread, t.submission_id,
						u.name AS user_name, u.email AS user_email,
						(SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
						(SELECT author FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_author
					FROM tickets t LEFT JOIN users u ON u.id = t.user_id
					ORDER BY t.staff_unread DESC, t.updated_at DESC LIMIT 500`
			)
			.all();
		return json({ tickets: results });
	}

	const ticket = await db
		.prepare(
			`SELECT t.*, u.name AS user_name, u.email AS user_email, u.created_at AS user_since
				FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`
		)
		.bind(id)
		.first<TicketRow & { user_name: string; user_email: string; user_since: string }>();
	if (!ticket) return json({ error: "not_found" }, 404);

	const [messages, submission] = await Promise.all([
		getMessages(db, id),
		ticket.submission_id
			? db.prepare(`SELECT id, form, status, data, created_at FROM submissions WHERE id = ?`).bind(ticket.submission_id).first<{ data: string }>()
			: null,
	]);
	if (ticket.staff_unread) await db.prepare(`UPDATE tickets SET staff_unread = 0 WHERE id = ?`).bind(id).run();

	return json({
		ticket,
		messages: messages.results,
		submission: submission && { ...submission, data: JSON.parse(submission.data) },
	});
};

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const body = await readJsonObject(request, 20_000);
	const id = Number(body?.id);
	const action = String(body?.action ?? "");

	const ticket = Number.isInteger(id)
		? await db
				.prepare(`SELECT t.id, t.subject, u.name AS user_name FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`)
				.bind(id)
				.first<{ id: number; subject: string; user_name: string | null }>()
		: null;
	if (!ticket) return json({ error: "not_found" }, 404);

	const label = `Ticket #${String(id).padStart(4, "0")}${ticket.user_name ? ` (${ticket.user_name})` : ""}`;

	if (action === "reply") {
		const message = cleanText(body?.body, MAX_MESSAGE);
		if (!message) return json({ error: "message_short" }, 400);

		await addMessage(db, id, "staff", message);
		if (body?.close === true) {
			await db.batch([
				db.prepare(`INSERT INTO ticket_messages (ticket_id, author, body) VALUES (?, 'system', 'closed:staff')`).bind(id),
				db.prepare(`UPDATE tickets SET status = 'closed' WHERE id = ?`).bind(id),
			]);
		}
		await logAction(db, "ticket-reply", null, `${label}: respuesta enviada${body?.close === true ? " y cerrado" : ""}`);
		return json({ ok: true });
	}

	if (action === "close" || action === "reopen") {
		const closing = action === "close";
		await addMessage(db, id, "system", closing ? "closed:staff" : "reopened:staff");
		await db.prepare(`UPDATE tickets SET status = ? WHERE id = ?`).bind(closing ? "closed" : "open", id).run();
		await logAction(db, closing ? "ticket-close" : "ticket-reopen", null, `${label}: ${closing ? "cerrado" : "reabierto"}`);
		return json({ ok: true });
	}

	return json({ error: "unknown_action" }, 400);
};

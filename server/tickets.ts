import type { D1Database } from "./types";

export const TICKET_CATEGORIES = ["soporte", "discord", "minecraft", "tep", "voluntariado", "otro"];

export const MAX_SUBJECT = 120;
export const MAX_MESSAGE = 4000;

export type TicketRow = {
	id: number;
	user_id: number;
	submission_id: number | null;
	category: string;
	subject: string;
	status: string;
	created_at: string;
	updated_at: string;
	user_unread: number;
	staff_unread: number;
};

export type MessageRow = { id: number; author: string; body: string; created_at: string };

export const cleanText = (value: unknown, max: number) =>
	String(value ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
		.trim()
		.slice(0, max);

export async function createTicket(
	db: D1Database,
	ticket: { userId: number; category: string; subject: string; submissionId?: number | null },
	first: { author: "user" | "system"; body: string }
): Promise<number> {
	// A ticket opened for a form doesn't need a reply yet: the form itself is
	// already waiting in its own tab of the panel.
	const { meta } = await db
		.prepare(`INSERT INTO tickets (user_id, submission_id, category, subject, staff_unread) VALUES (?, ?, ?, ?, ?)`)
		.bind(ticket.userId, ticket.submissionId ?? null, ticket.category, ticket.subject, first.author === "user" ? 1 : 0)
		.run();
	const id = Number(meta.last_row_id);
	await db.prepare(`INSERT INTO ticket_messages (ticket_id, author, body) VALUES (?, ?, ?)`).bind(id, first.author, first.body).run();
	return id;
}

// Adds a message and moves the ticket along: a user message waits for us, a
// staff reply waits for the user, a system note (e.g. "status:accepted") just
// tells the user something changed.
export function addMessage(db: D1Database, ticketId: number, author: "user" | "staff" | "system", body: string) {
	const update =
		author === "user"
			? `UPDATE tickets SET status = 'open', staff_unread = 1, updated_at = datetime('now') WHERE id = ?`
			: author === "staff"
				? `UPDATE tickets SET status = 'answered', user_unread = 1, updated_at = datetime('now') WHERE id = ?`
				: `UPDATE tickets SET user_unread = 1, updated_at = datetime('now') WHERE id = ?`;

	return db.batch([
		db.prepare(`INSERT INTO ticket_messages (ticket_id, author, body) VALUES (?, ?, ?)`).bind(ticketId, author, body),
		db.prepare(update).bind(ticketId),
	]);
}

export function getMessages(db: D1Database, ticketId: number) {
	return db
		.prepare(`SELECT id, author, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id`)
		.bind(ticketId)
		.all<MessageRow>();
}

// The form behind a ticket, with only what the account owner should see.
export async function linkedSubmission(db: D1Database, submissionId: number | null) {
	if (!submissionId) return null;
	const row = await db
		.prepare(`SELECT id, form, status, created_at FROM submissions WHERE id = ?`)
		.bind(submissionId)
		.first<{ id: number; form: string; status: string; created_at: string }>();
	return row ?? null;
}

// Subject of the ticket created for a form sent while signed in, in the
// language the form was filled in.
export function submissionSubject(form: string, id: number, lang: string): string {
	const ref = `#${String(id).padStart(4, "0")}`;
	const subjects: Record<string, [string, string]> = {
		discord: ["Solicitud de servicio de Discord", "Discord service request"],
		minecraft: ["Solicitud de servicio de Minecraft", "Minecraft service request"],
		voluntariado: ["Postulación al voluntariado", "Volunteer application"],
	};
	const [es, en] = subjects[form] ?? ["Solicitud", "Request"];
	return `${lang === "en" ? en : es} ${ref}`;
}

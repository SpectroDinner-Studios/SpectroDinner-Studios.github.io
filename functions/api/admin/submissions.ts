import { ensureSchema, logAction, type SubmissionRow } from "../../../server/db";
import { FORM_IDS, validateSubmission } from "../../../server/forms";
import { json, readJsonObject } from "../../../server/http";
import { addMessage } from "../../../server/tickets";
import type { D1Database, PagesHandler } from "../../../server/types";

// GET  /api/admin/submissions?form=review  → rows (newest first) + counts
// POST /api/admin/submissions { id, action }              → moderate / change status / delete
// POST /api/admin/submissions { id, action: "note", note } → private note ("" removes it)
// POST /api/admin/submissions { action: "restore", row }   → undo a delete
// POST /api/admin/submissions { action: "read-all", form } → mark every unchecked one as checked
export const onRequestGet: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	await ensureSchema(db);

	const form = new URL(request.url).searchParams.get("form");
	const byForm = FORM_IDS.includes(form ?? "");

	const query = db.prepare(
		`SELECT s.id, s.created_at, s.form, s.status, s.data, n.note, t.id AS ticket_id
			FROM submissions s
			LEFT JOIN submission_notes n ON n.submission_id = s.id
			LEFT JOIN tickets t ON t.submission_id = s.id
			${byForm ? "WHERE s.form = ?" : ""}
			ORDER BY s.created_at DESC, s.id DESC LIMIT 500`
	);
	const rows = await (byForm ? query.bind(form) : query).all<SubmissionRow & { note: string | null }>();

	const [counts, recent, tickets, users] = await Promise.all([
		db
			.prepare(`SELECT form, status, COUNT(*) AS n FROM submissions GROUP BY form, status`)
			.all<{ form: string; status: string; n: number }>(),
		db
			.prepare(`SELECT form, COUNT(*) AS n FROM submissions WHERE created_at > datetime('now', '-7 days') GROUP BY form`)
			.all<{ form: string; n: number }>(),
		db
			.prepare(`SELECT COALESCE(SUM(status != 'closed'), 0) AS open, COALESCE(SUM(staff_unread), 0) AS unread FROM tickets`)
			.first<{ open: number; unread: number }>(),
		db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>(),
	]);

	return json({
		submissions: rows.results.map((row) => ({ ...row, data: JSON.parse(row.data) })),
		counts: counts.results,
		recent: recent.results,
		tickets: tickets ?? { open: 0, unread: 0 },
		users: users?.n ?? 0,
	});
};

// Statuses a row of each kind can be in (see server/db.ts).
const REVIEW_STATUSES = ["live", "approved", "hidden", "pending"];
const OTHER_STATUSES = ["new", "read", "accepted", "rejected", "done"];

// action → the status it sets, whether it's for reviews, and how the
// Historial describes it.
const ACTIONS: Record<string, { status: string; review: boolean; label: string }> = {
	approve: { status: "approved", review: true, label: "aprobada" },
	hide: { status: "hidden", review: true, label: "ocultada" },
	read: { status: "read", review: false, label: "marcada como leída" },
	unread: { status: "new", review: false, label: "marcada como nueva" },
	accept: { status: "accepted", review: false, label: "aceptada" },
	reject: { status: "rejected", review: false, label: "rechazada" },
	done: { status: "done", review: false, label: "terminada" },
};

// Status changes the owner of a tracked request is told about.
const TRACKED_STATUSES = ["read", "accepted", "rejected", "done"];

const FORM_LABELS: Record<string, string> = {
	review: "Valoración",
	discord: "Discord",
	minecraft: "Minecraft",
	voluntariado: "Voluntariado",
};

// "Valoración #0005 (SpamBot3000)"
const describe = (id: number, form: string, data: Record<string, unknown>) => {
	const name = String(data.nickname ?? data.nombre ?? "").slice(0, 60);
	return `${FORM_LABELS[form] ?? form} #${String(id).padStart(4, "0")}${name ? ` (${name})` : ""}`;
};

const findRow = async (db: D1Database, id: number) => {
	const row = await db.prepare(`SELECT form, data FROM submissions WHERE id = ?`).bind(id).first<{ form: string; data: string }>();
	return row ? { form: row.form, data: JSON.parse(row.data) as Record<string, unknown> } : null;
};

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	await ensureSchema(db);

	const body = await readJsonObject(request, 100_000);
	const id = Number(body?.id);
	const action = String(body?.action ?? "");

	// Bulk: mark every unchecked submission of one form as checked
	// (reviews: live → approved, they stay on the site; others: new → read).
	if (action === "read-all") {
		const form = String(body?.form ?? "");
		if (!FORM_IDS.includes(form)) return json({ error: "invalid_form" }, 400);
		const [from, to] = form === "review" ? ["live", "approved"] : ["new", "read"];
		await db.prepare(`UPDATE submissions SET status = ? WHERE form = ? AND status = ?`).bind(to, form, from).run();
		await logAction(db, "read-all", null, `${FORM_LABELS[form]}: todo marcado como ${form === "review" ? "revisado" : "leído"}`);
		return json({ ok: true });
	}

	// Undo a delete: put the row (and its note) back exactly as the panel saw it.
	if (action === "restore") {
		const row = body?.row as Record<string, unknown> | undefined;
		const rowId = Number(row?.id);
		const form = String(row?.form ?? "");
		const status = String(row?.status ?? "");
		const createdAt = String(row?.created_at ?? "");
		const data = row?.data;
		const note = typeof row?.note === "string" ? row.note.trim().slice(0, 2000) : "";

		const allowed = form === "review" ? REVIEW_STATUSES : OTHER_STATUSES;
		if (
			!Number.isInteger(rowId) || rowId < 1 ||
			!FORM_IDS.includes(form) || !allowed.includes(status) ||
			!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(createdAt) ||
			!data || typeof data !== "object" || Array.isArray(data)
		) {
			return json({ error: "invalid_row" }, 400);
		}

		const clean = validateSubmission({ ...(data as Record<string, unknown>), form });
		if (!clean.ok) return json({ error: clean.error }, 400);

		await db.batch([
			db
				.prepare(`INSERT OR IGNORE INTO submissions (id, created_at, form, status, data) VALUES (?, ?, ?, ?, ?)`)
				.bind(rowId, createdAt, form, status, JSON.stringify(clean.data)),
			...(note
				? [db.prepare(`INSERT OR REPLACE INTO submission_notes (submission_id, note) VALUES (?, ?)`).bind(rowId, note)]
				: []),
		]);
		await logAction(db, "restore", rowId, `${describe(rowId, form, clean.data)}: restaurada`);
		return json({ ok: true });
	}

	if (!Number.isInteger(id)) return json({ error: "invalid_id" }, 400);

	const row = await findRow(db, id);
	if (!row) return json({ error: "not_found" }, 404);
	const label = describe(id, row.form, row.data);

	if (action === "delete") {
		await db.batch([
			db.prepare(`DELETE FROM submissions WHERE id = ?`).bind(id),
			db.prepare(`DELETE FROM submission_notes WHERE submission_id = ?`).bind(id),
		]);
		await logAction(db, "delete", id, `${label}: eliminada`);
		return json({ ok: true });
	}

	if (action === "note") {
		const note = String(body?.note ?? "").trim().slice(0, 2000);
		await (note
			? db
					.prepare(
						`INSERT INTO submission_notes (submission_id, note, updated_at) VALUES (?, ?, datetime('now'))
							ON CONFLICT(submission_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`
					)
					.bind(id, note)
					.run()
			: db.prepare(`DELETE FROM submission_notes WHERE submission_id = ?`).bind(id).run());
		await logAction(db, "note", id, `${label}: nota ${note ? "guardada" : "borrada"}`);
		return json({ ok: true });
	}

	const change = ACTIONS[action];
	if (!change) return json({ error: "unknown_action" }, 400);

	// Review actions only apply to reviews, and the rest only to the other forms.
	if (change.review !== (row.form === "review")) return json({ error: "invalid_action" }, 400);

	await db.prepare(`UPDATE submissions SET status = ? WHERE id = ?`).bind(change.status, id).run();
	await logAction(db, action, id, `${label}: ${change.label}`);

	// Sent while signed in: tell the account owner in its ticket.
	if (TRACKED_STATUSES.includes(change.status)) {
		const ticket = await db.prepare(`SELECT id FROM tickets WHERE submission_id = ?`).bind(id).first<{ id: number }>();
		if (ticket) await addMessage(db, ticket.id, "system", `status:${change.status}`);
	}

	return json({ ok: true });
};

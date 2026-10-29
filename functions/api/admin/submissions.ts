import { ensureSchema, type SubmissionRow } from "../../../server/db";
import { FORM_IDS } from "../../../server/forms";
import { json, readJsonObject } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";

// GET  /api/admin/submissions?form=review  → rows (newest first) + counts
// POST /api/admin/submissions { id, action } → moderate / mark / delete
export const onRequestGet: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	await ensureSchema(db);

	const form = new URL(request.url).searchParams.get("form");

	const rows = FORM_IDS.includes(form ?? "")
		? await db
				.prepare(
					`SELECT id, created_at, form, status, data FROM submissions
						WHERE form = ? ORDER BY id DESC LIMIT 500`
				)
				.bind(form)
				.all<SubmissionRow>()
		: await db
				.prepare(
					`SELECT id, created_at, form, status, data FROM submissions
						ORDER BY id DESC LIMIT 500`
				)
				.all<SubmissionRow>();

	const [counts, recent] = await Promise.all([
		db
			.prepare(`SELECT form, status, COUNT(*) AS n FROM submissions GROUP BY form, status`)
			.all<{ form: string; status: string; n: number }>(),
		db
			.prepare(`SELECT form, COUNT(*) AS n FROM submissions WHERE created_at > datetime('now', '-7 days') GROUP BY form`)
			.all<{ form: string; n: number }>(),
	]);

	return json({
		submissions: rows.results.map((row) => ({ ...row, data: JSON.parse(row.data) })),
		counts: counts.results,
		recent: recent.results,
	});
};

const STATUS_FOR_ACTION: Record<string, string> = {
	approve: "approved",
	hide: "hidden",
	read: "read",
	unread: "new",
};

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	await ensureSchema(db);

	const body = await readJsonObject(request, 1000);
	const id = Number(body?.id);
	const action = String(body?.action ?? "");

	// Bulk: mark every new submission of one (non-review) form as read.
	if (action === "read-all") {
		const form = String(body?.form ?? "");
		if (!FORM_IDS.includes(form) || form === "review") return json({ error: "invalid_form" }, 400);
		await db.prepare(`UPDATE submissions SET status = 'read' WHERE form = ? AND status = 'new'`).bind(form).run();
		return json({ ok: true });
	}

	if (!Number.isInteger(id)) return json({ error: "invalid_id" }, 400);

	if (action === "delete") {
		await db.prepare(`DELETE FROM submissions WHERE id = ?`).bind(id).run();
		return json({ ok: true });
	}

	const status = STATUS_FOR_ACTION[action];
	if (!status) return json({ error: "unknown_action" }, 400);

	// approve/hide only make sense for reviews; read/unread for everything else.
	const isReviewAction = action === "approve" || action === "hide";
	await db
		.prepare(
			`UPDATE submissions SET status = ? WHERE id = ? AND (form = 'review') = ?`
		)
		.bind(status, id, isReviewAction ? 1 : 0)
		.run();

	return json({ ok: true });
};

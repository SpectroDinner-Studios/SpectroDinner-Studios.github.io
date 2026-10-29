import { ensureSchema } from "../../server/db";
import { json } from "../../server/http";
import type { PagesHandler } from "../../server/types";

// Public list of reviews: every one that hasn't been hidden or deleted in
// /admin. Never cached, so a deletion disappears from the site at once.
export const onRequestGet: PagesHandler = async ({ env }) => {
	if (!env.DB) return json({ reviews: [] });

	await ensureSchema(env.DB);

	const { results } = await env.DB.prepare(
		`SELECT id, data FROM submissions
			WHERE form = 'review' AND status IN ('live', 'approved')
			ORDER BY id DESC LIMIT 60`
	).all<{ id: number; data: string }>();

	const reviews = results.map((row) => {
		const data = JSON.parse(row.data) as Record<string, unknown>;
		return {
			id: row.id,
			name: String(data.nickname ?? ""),
			service: String(data.service ?? ""),
			rating: Number(data.rating) || 5,
			text: String(data.comment ?? ""),
		};
	});

	return json({ reviews });
};

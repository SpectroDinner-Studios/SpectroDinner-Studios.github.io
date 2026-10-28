import { ensureSchema } from "../../server/db";
import { json } from "../../server/http";
import type { PagesHandler } from "../../server/types";

// Public list of reviews approved from the admin panel.
export const onRequestGet: PagesHandler = async ({ env }) => {
	if (!env.DB) return json({ reviews: [] });

	await ensureSchema(env.DB);

	const { results } = await env.DB.prepare(
		`SELECT id, data FROM submissions
			WHERE form = 'review' AND status = 'approved'
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

	return json({ reviews }, 200, { "Cache-Control": "public, max-age=60" });
};

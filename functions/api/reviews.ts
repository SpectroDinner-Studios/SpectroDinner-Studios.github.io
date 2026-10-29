import { ensureSchema } from "../../server/db";
import { corsPreflight, json, withCors } from "../../server/http";
import type { Env, PagesHandler } from "../../server/types";

// Public list of reviews: every one that hasn't been hidden or deleted in
// /admin. Never cached, so a deletion disappears from the site at once.
export const onRequestOptions: PagesHandler = async ({ request }) => corsPreflight(request);

export const onRequestGet: PagesHandler = async ({ request, env }) => withCors(request, await list(env.DB));

const list = async (db: Env["DB"]): Promise<Response> => {
	if (!db) return json({ reviews: [] });

	await ensureSchema(db);

	const { results } = await db.prepare(
		`SELECT id, data FROM submissions
			WHERE form = 'review' AND status IN ('live', 'approved')
			ORDER BY created_at DESC, id DESC LIMIT 100`
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

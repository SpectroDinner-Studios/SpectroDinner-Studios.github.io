import { logAction } from "../../../server/db";
import { json, readJsonObject } from "../../../server/http";
import {
	COURSES,
	GROUPS,
	MAX_LIMIT,
	type SurveyGroup,
	closeGroups,
	currentPassword,
	ensureSurveySchema,
	openGroup,
	rotatePassword,
} from "../../../server/survey";
import type { PagesHandler } from "../../../server/types";

const label = (course: number, grp: string) => `${course}.º DBH - ${grp}`;

const validGroup = (course: unknown, grp: unknown) => COURSES.includes(Number(course)) && GROUPS.includes(String(grp));

const validLimit = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_LIMIT;

// GET                  → the 16 groups, the current password and the result counts
// GET ?vista=respuestas → every individual response
// POST { action: "open", course, grp } | { action: "close" } | { action: "rotate" }
// POST { action: "config", course, grp, usesPerPassword, maxAccesses } (0 = no limit)
// POST { action: "delete", id }
export const onRequestGet: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	await ensureSurveySchema(db);

	if (new URL(request.url).searchParams.get("vista") === "respuestas") {
		const { results } = await db
			.prepare(`SELECT id, course, grp, choice, reason, improvement, received_on FROM survey_responses ORDER BY id DESC LIMIT 5000`)
			.all();
		return json({ responses: results });
	}

	const [groups, counts] = await Promise.all([
		db.prepare(`SELECT * FROM survey_groups ORDER BY course, grp`).all<SurveyGroup>(),
		db
			.prepare(`SELECT course, grp, choice, COUNT(*) AS n FROM survey_responses GROUP BY course, grp, choice`)
			.all<{ course: number; grp: string; choice: string; n: number }>(),
	]);

	const active = groups.results.find((g) => g.active);

	return json({
		groups: groups.results.map(({ seed: _seed, ...group }) => group),
		password: active ? await currentPassword(active, env.SESSION_SECRET!) : null,
		counts: counts.results,
	});
};

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const secret = env.SESSION_SECRET!;
	await ensureSurveySchema(db);

	const body = await readJsonObject(request, 1000);
	const action = String(body?.action ?? "");

	if (action === "open") {
		if (!validGroup(body?.course, body?.grp)) return json({ error: "invalid_group" }, 400);
		const course = Number(body?.course);
		const grp = String(body?.grp);
		await openGroup(db, secret, course, grp);
		await logAction(db, "survey-open", null, `Encuesta: ${label(course, grp)} activado`);
		return json({ ok: true });
	}

	if (action === "close") {
		await closeGroups(db);
		await logAction(db, "survey-close", null, "Encuesta: acceso desactivado");
		return json({ ok: true });
	}

	if (action === "rotate") {
		await rotatePassword(db, secret);
		await logAction(db, "survey-rotate", null, "Encuesta: contraseña cambiada a mano");
		return json({ ok: true });
	}

	if (action === "config") {
		if (!validGroup(body?.course, body?.grp) || !validLimit(body?.usesPerPassword) || !validLimit(body?.maxAccesses)) {
			return json({ error: "invalid_config" }, 400);
		}
		const course = Number(body?.course);
		const grp = String(body?.grp);
		await db
			.prepare(`UPDATE survey_groups SET uses_per_password = ?, max_accesses = ?, password_uses = 0 WHERE course = ? AND grp = ?`)
			.bind(body?.usesPerPassword, body?.maxAccesses, course, grp)
			.run();
		await logAction(db, "survey-config", null, `Encuesta: límites de ${label(course, grp)} cambiados`);
		return json({ ok: true });
	}

	if (action === "delete") {
		const id = Number(body?.id);
		if (!Number.isInteger(id)) return json({ error: "invalid_id" }, 400);
		const { meta } = await db.prepare(`DELETE FROM survey_responses WHERE id = ?`).bind(id).run();
		if (meta.changes !== 1) return json({ error: "not_found" }, 404);
		await logAction(db, "survey-delete", null, `Encuesta: respuesta #${String(id).padStart(3, "0")} borrada`);
		return json({ ok: true });
	}

	return json({ error: "unknown_action" }, 400);
};

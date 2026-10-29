import { logAction } from "../../../server/db";
import { json, readJsonObject } from "../../../server/http";
import { getSettings, isSettingKey, setSetting, type SettingKey } from "../../../server/settings";
import type { PagesHandler } from "../../../server/types";

const LABELS: Record<SettingKey, string> = {
	volunteering_open: "Voluntariado abierto",
	reviews_instant: "Valoraciones publicadas al instante",
	maintenance: "Modo mantenimiento",
};

// GET  /api/admin/settings → every switch
// POST /api/admin/settings { key, value } → change one
export const onRequestGet: PagesHandler = async ({ env }) => json({ settings: await getSettings(env.DB!) });

export const onRequestPost: PagesHandler = async ({ request, env }) => {
	const body = await readJsonObject(request, 1000);
	const key = String(body?.key ?? "");
	if (!isSettingKey(key) || typeof body?.value !== "boolean") return json({ error: "invalid_setting" }, 400);

	await setSetting(env.DB!, key, body.value);
	await logAction(env.DB!, "setting", null, `${LABELS[key]}: ${body.value ? "sí" : "no"}`);

	return json({ ok: true, settings: await getSettings(env.DB!) });
};

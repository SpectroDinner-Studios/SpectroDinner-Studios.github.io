import type { D1Database } from "./types";

// Site switches changed from the panel's Ajustes tab. Stored as "1"/"0";
// anything never touched keeps its default.
export const SETTING_DEFAULTS = {
	volunteering_open: true,
	reviews_instant: true,
	maintenance: false,
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, boolean>;

export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTING_DEFAULTS, key);

// Only the switches that were changed at least once.
export async function getStoredSettings(db: D1Database): Promise<Partial<Settings>> {
	const { results } = await db.prepare(`SELECT key, value FROM settings`).all<{ key: string; value: string }>();
	const stored: Partial<Settings> = {};
	for (const row of results) if (isSettingKey(row.key)) stored[row.key] = row.value === "1";
	return stored;
}

export async function getSettings(db: D1Database): Promise<Settings> {
	return { ...SETTING_DEFAULTS, ...(await getStoredSettings(db)) };
}

export function setSetting(db: D1Database, key: SettingKey, value: boolean) {
	return db
		.prepare(
			`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
				ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
		)
		.bind(key, value ? "1" : "0")
		.run();
}

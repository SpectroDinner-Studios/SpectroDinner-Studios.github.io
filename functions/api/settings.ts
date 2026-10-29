import { ensureSchema } from "../../server/db";
import { corsPreflight, json, withCors } from "../../server/http";
import { getSettings, SETTING_DEFAULTS } from "../../server/settings";
import type { PagesHandler } from "../../server/types";

// The switches public pages need: is volunteering open, do reviews go live at
// once. (Maintenance is in /config.json, which every page already reads.)
export const onRequestOptions: PagesHandler = async ({ request }) => corsPreflight(request);

export const onRequestGet: PagesHandler = async ({ request, env }) => {
	let settings = SETTING_DEFAULTS;

	if (env.DB) {
		await ensureSchema(env.DB);
		settings = await getSettings(env.DB);
	}

	return withCors(
		request,
		json({ volunteering_open: settings.volunteering_open, reviews_instant: settings.reviews_instant })
	);
};

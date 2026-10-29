import { ensureSchema } from "../server/db";
import { corsPreflight, json, withCors } from "../server/http";
import { getStoredSettings } from "../server/settings";
import type { PagesHandler } from "../server/types";

// /config.json is read by every page to know whether the site is in
// maintenance. Serve the static file, with `maintenance` taken from the
// panel's Ajustes once it has been switched there.
export const onRequestOptions: PagesHandler = async ({ request }) => corsPreflight(request);

export const onRequestGet: PagesHandler = async ({ request, env, next }) => {
	let config: Record<string, unknown> = {};

	try {
		config = await (await next()).json();
	} catch {}

	if (env.DB) {
		try {
			await ensureSchema(env.DB);
			const { maintenance } = await getStoredSettings(env.DB);
			if (maintenance !== undefined) config.maintenance = maintenance;
		} catch {}
	}

	return withCors(request, json(config));
};

// TimeEconomyPlugin facts. The release info is fetched from Modrinth at build
// time, so every deploy shows the current version; if Modrinth can't be
// reached, the last known values below are used instead.

export const TEP_LINKS = {
	modrinth: "https://modrinth.com/plugin/timeeconomyplugin",
	versions: "https://modrinth.com/plugin/timeeconomyplugin/versions",
	github: "https://github.com/Elmoderador/TimeEconomyPlugin",
	releases: "https://github.com/Elmoderador/TimeEconomyPlugin/releases",
	issues: "https://github.com/Elmoderador/TimeEconomyPlugin/issues",
	readme: "https://github.com/Elmoderador/TimeEconomyPlugin#readme",
	license: "https://github.com/Elmoderador/TimeEconomyPlugin/blob/main/LICENSE",
};

export type TepRelease = {
	version: string;
	versionCount: number;
	gameVersions: string[];
	published: string; // first public release, YYYY-MM-DD
	updated: string; // latest release, YYYY-MM-DD
};

const FALLBACK: TepRelease = {
	version: "1.12.0",
	versionCount: 14,
	gameVersions: ["1.21.11", "26.1", "26.1.1", "26.1.2", "26.2"],
	published: "2026-08-06",
	updated: "2026-08-12",
};

const API = "https://api.modrinth.com/v2/project/timeeconomyplugin";

async function fetchRelease(): Promise<TepRelease> {
	try {
		const init = {
			headers: { "User-Agent": "SpectroDinner-Studios/website (spectrodinner-studios.pages.dev)" },
			signal: AbortSignal.timeout(8000),
		};

		const [projectRes, versionsRes] = await Promise.all([
			fetch(API, init),
			fetch(`${API}/version`, init),
		]);
		if (!projectRes.ok || !versionsRes.ok) return FALLBACK;

		const project = await projectRes.json();
		const versions: { version_number: string; date_published: string }[] = await versionsRes.json();
		if (!versions.length) return FALLBACK;

		return {
			version: versions[0].version_number,
			versionCount: versions.length,
			gameVersions: project.game_versions?.length ? project.game_versions : FALLBACK.gameVersions,
			published: String(project.published).slice(0, 10),
			updated: versions[0].date_published.slice(0, 10),
		};
	} catch {
		return FALLBACK;
	}
}

let release: Promise<TepRelease> | null = null;

// One request per build, shared by every page that shows T.E.P. info.
export function getTepRelease(): Promise<TepRelease> {
	release ??= fetchRelease();
	return release;
}

export function minecraftRange(gameVersions: string[]): string {
	return gameVersions.length > 1
		? `${gameVersions[0]} – ${gameVersions[gameVersions.length - 1]}`
		: gameVersions[0] ?? "";
}

export function formatDate(isoDate: string, lang: "es" | "en"): string {
	return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

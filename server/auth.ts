import type { D1Database } from "./types";

const encoder = new TextEncoder();

// `__Host-` cookies must be Secure, Path=/ and host-only: no subdomain can set or read them.
export const SESSION_COOKIE = "__Host-sd_admin";

const SESSION_TTL_S = 60 * 60 * 12; // a session never lives longer than 12 h
const IDLE_TTL_S = 60 * 60 * 2; // …and ends after 2 h without activity
const TOUCH_EVERY_S = 60 * 5; // how often last_seen is refreshed

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
	let binary = "";
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(value: string): Promise<string> {
	return toBase64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return result === 0;
}

// Compares digests, so neither the content nor the length of the password leaks.
export async function passwordMatches(candidate: string, expected: string): Promise<boolean> {
	return timingSafeEqual(await sha256(candidate), await sha256(expected));
}

export function ipHash(request: Request, secret: string): Promise<string> {
	return sha256(`${request.headers.get("CF-Connecting-IP") ?? "unknown"}|${secret}`);
}

// "Chrome · Windows" — enough to recognise a device in the access log.
export function shortUserAgent(ua: string | null): string {
	if (!ua) return "Desconocido";
	const browser =
		/Edg\//.test(ua) ? "Edge" :
		/OPR\/|Opera/.test(ua) ? "Opera" :
		/Firefox\//.test(ua) ? "Firefox" :
		/Chrome\//.test(ua) ? "Chrome" :
		/Safari\//.test(ua) ? "Safari" :
		/curl|wget|python|node|Go-http/i.test(ua) ? "Script" :
		"Navegador";
	const os =
		/Windows/.test(ua) ? "Windows" :
		/Android/.test(ua) ? "Android" :
		/iPhone|iPad|iOS/.test(ua) ? "iOS" :
		/Mac OS X|Macintosh/.test(ua) ? "macOS" :
		/Linux/.test(ua) ? "Linux" :
		"";
	return os ? `${browser} · ${os}` : browser;
}

function readCookie(request: Request, name: string): string | undefined {
	const header = request.headers.get("Cookie") ?? "";
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return undefined;
}

const hashToken = (token: string, secret: string) => sha256(`${token}|${secret}`);

export type Session = {
	token_hash: string;
	created_at: string;
	expires_at: string;
	last_seen: string;
};

export async function createSession(db: D1Database, secret: string, request: Request): Promise<string> {
	const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

	await db
		.prepare(
			`INSERT INTO admin_sessions (token_hash, expires_at, user_agent)
				VALUES (?, datetime('now', ?), ?)`
		)
		.bind(await hashToken(token, secret), `+${SESSION_TTL_S} seconds`, shortUserAgent(request.headers.get("User-Agent")))
		.run();

	return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(): string {
	return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function getSession(
	request: Request,
	db: D1Database,
	secret: string | undefined
): Promise<Session | null> {
	// Without a secret nothing can be verified — never accept a session.
	if (!secret) return null;

	const token = readCookie(request, SESSION_COOKIE);
	if (!token || token.length > 100) return null;

	const tokenHash = await hashToken(token, secret);

	const session = await db
		.prepare(
			`SELECT token_hash, created_at, expires_at, last_seen FROM admin_sessions
				WHERE token_hash = ?
					AND expires_at > datetime('now')
					AND last_seen > datetime('now', ?)`
		)
		.bind(tokenHash, `-${IDLE_TTL_S} seconds`)
		.first<Session>();

	if (!session) return null;

	await db
		.prepare(
			`UPDATE admin_sessions SET last_seen = datetime('now')
				WHERE token_hash = ? AND last_seen < datetime('now', ?)`
		)
		.bind(tokenHash, `-${TOUCH_EVERY_S} seconds`)
		.run();

	return session;
}

export async function destroySession(request: Request, db: D1Database, secret: string): Promise<void> {
	const token = readCookie(request, SESSION_COOKIE);
	if (!token) return;
	await db.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).bind(await hashToken(token, secret)).run();
}

export async function logEvent(db: D1Database, kind: string, request: Request, secret: string): Promise<void> {
	await db
		.prepare(`INSERT INTO admin_events (kind, ip_hash, user_agent) VALUES (?, ?, ?)`)
		.bind(kind, await ipHash(request, secret), shortUserAgent(request.headers.get("User-Agent")))
		.run();
}

// Drops expired sessions and access-log entries older than 90 days.
export async function pruneAuthTables(db: D1Database): Promise<void> {
	await db.batch([
		db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= datetime('now') OR last_seen <= datetime('now', ?)`).bind(`-${IDLE_TTL_S} seconds`),
		db.prepare(`DELETE FROM admin_events WHERE at <= datetime('now', '-90 days')`),
	]);
}

import { ipHash, readCookie, sha256, shortUserAgent, timingSafeEqual, toBase64Url } from "./auth";
import type { D1Database } from "./types";

/*
	Site accounts, separate from the admin login.

	- Passwords: PBKDF2-SHA256 with a random salt, stored as
	  "pbkdf2-sha256$<iterations>$<salt>$<hash>". Never stored or logged in clear.
	- Sessions: a random token in an HttpOnly `__Host-` cookie; only a salted
	  hash of it is stored. 30 days, renewed while the account is used.
	- `sd_signed_in=1` is a harmless hint cookie (no secret in it) so pages can
	  show "Mi cuenta" without asking the server on every view.
*/

export const USER_COOKIE = "__Host-sd_user";
export const HINT_COOKIE = "sd_signed_in";

const SESSION_TTL_S = 60 * 60 * 24 * 30;
const TOUCH_EVERY_S = 60 * 60;
const PBKDF2_ITERATIONS = 100_000; // the most Cloudflare Workers allow

const encoder = new TextEncoder();

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
	Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
	return toBase64Url(bits);
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, iterations, salt, hash] = stored.split("$");
	if (scheme !== "pbkdf2-sha256" || !salt || !hash || !(Number(iterations) > 0)) return false;
	return timingSafeEqual(await pbkdf2(password, fromBase64Url(salt), Number(iterations)), hash);
}

// Checked when an email isn't registered, so a wrong email takes as long as a
// wrong password and doesn't reveal which accounts exist.
let dummyHash: Promise<string> | null = null;
export const burnPasswordCheck = async (password: string) => {
	dummyHash ??= hashPassword("not-a-real-account");
	await verifyPassword(password, await dummyHash);
};

// ---------- Validation ----------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase().slice(0, 120);

export const cleanName = (value: unknown) =>
	String(value ?? "")
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 40);

const COMMON_PASSWORDS = new Set(["12345678", "123456789", "1234567890", "password", "password1", "contraseña", "qwertyui", "11111111", "00000000", "abcdefgh", "spectrodinner"]);

// "" when fine, otherwise an error code the pages translate.
export function passwordProblem(password: string, email = ""): string {
	if (password.length < 8) return "password_short";
	if (password.length > 200) return "password_long";
	if (COMMON_PASSWORDS.has(password.toLowerCase()) || password.toLowerCase() === email) return "password_common";
	return "";
}

// ---------- Sessions ----------

export type User = { id: number; email: string; name: string; created_at: string };
export type UserSession = User & { token_hash: string };

const hashToken = (token: string, secret: string) => sha256(`user|${token}|${secret}`);

const sessionCookies = (token: string, maxAge: number) => [
	`${USER_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
	`${HINT_COOKIE}=${maxAge ? "1" : ""}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax`,
];

export const clearUserCookies = () => sessionCookies("", 0);

// Starts a session and returns the Set-Cookie headers for it.
export async function createUserSession(db: D1Database, secret: string, userId: number, request: Request): Promise<string[]> {
	const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

	await db.batch([
		db
			.prepare(
				`INSERT INTO user_sessions (token_hash, user_id, expires_at, user_agent)
					VALUES (?, ?, datetime('now', ?), ?)`
			)
			.bind(await hashToken(token, secret), userId, `+${SESSION_TTL_S} seconds`, shortUserAgent(request.headers.get("User-Agent"))),
		db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).bind(userId),
	]);

	return sessionCookies(token, SESSION_TTL_S);
}

export async function getUser(request: Request, db: D1Database, secret: string): Promise<UserSession | null> {
	const token = readCookie(request, USER_COOKIE);
	if (!token || token.length > 100) return null;

	const tokenHash = await hashToken(token, secret);
	const row = await db
		.prepare(
			`SELECT u.id, u.email, u.name, u.created_at, s.token_hash,
					s.last_seen < datetime('now', ?) AS stale
				FROM user_sessions s JOIN users u ON u.id = s.user_id
				WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.disabled = 0`
		)
		.bind(`-${TOUCH_EVERY_S} seconds`, tokenHash)
		.first<UserSession & { stale: number }>();

	if (!row) return null;

	// Using the account keeps the session alive.
	if (row.stale) {
		await db
			.prepare(`UPDATE user_sessions SET last_seen = datetime('now'), expires_at = datetime('now', ?) WHERE token_hash = ?`)
			.bind(`+${SESSION_TTL_S} seconds`, tokenHash)
			.run();
	}

	const { stale: _stale, ...user } = row;
	return user;
}

export async function destroyUserSession(request: Request, db: D1Database, secret: string): Promise<void> {
	const token = readCookie(request, USER_COOKIE);
	if (token && token.length <= 100) {
		await db.prepare(`DELETE FROM user_sessions WHERE token_hash = ?`).bind(await hashToken(token, secret)).run();
	}
}

// ---------- Password reset links (made in the panel) ----------

export async function createResetToken(db: D1Database, secret: string, userId: number): Promise<string> {
	const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	await db.batch([
		db.prepare(`DELETE FROM password_resets WHERE user_id = ?`).bind(userId),
		db
			.prepare(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+24 hours'))`)
			.bind(await hashToken(token, secret), userId),
	]);
	return token;
}

export async function findResetUser(db: D1Database, secret: string, token: string): Promise<number | null> {
	if (!token || token.length > 100) return null;
	const row = await db
		.prepare(`SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > datetime('now')`)
		.bind(await hashToken(token, secret))
		.first<{ user_id: number }>();
	return row?.user_id ?? null;
}

// ---------- Rate limiting ----------

export const userIp = (request: Request, secret: string) => ipHash(request, `user|${secret}`);

export async function countEvents(
	db: D1Database,
	kind: string,
	minutes: number,
	by: { ip?: string; userId?: number }
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM user_events
				WHERE kind = ? AND at > datetime('now', ?) AND ${by.userId !== undefined ? "user_id = ?" : "ip_hash = ?"}`
		)
		.bind(kind, `-${minutes} minutes`, by.userId ?? by.ip ?? "")
		.first<{ n: number }>();
	return row?.n ?? 0;
}

export function logUserEvent(db: D1Database, kind: string, ip: string, userId: number | null = null) {
	return db.prepare(`INSERT INTO user_events (kind, ip_hash, user_id) VALUES (?, ?, ?)`).bind(kind, ip, userId).run();
}

export async function pruneUserTables(db: D1Database): Promise<void> {
	await db.batch([
		db.prepare(`DELETE FROM user_sessions WHERE expires_at <= datetime('now')`),
		db.prepare(`DELETE FROM password_resets WHERE expires_at <= datetime('now')`),
		db.prepare(`DELETE FROM user_events WHERE at <= datetime('now', '-30 days')`),
	]);
}

// Removes an account and everything tied to it (its tickets included). Form
// submissions stay: they were sent separately and also reached Make.
export function deleteUserStatements(db: D1Database, userId: number) {
	return [
		db.prepare(`DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)`).bind(userId),
		db.prepare(`DELETE FROM tickets WHERE user_id = ?`).bind(userId),
		db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(userId),
		db.prepare(`DELETE FROM password_resets WHERE user_id = ?`).bind(userId),
		db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
	];
}

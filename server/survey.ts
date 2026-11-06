import { readCookie, sha256, toBase64Url } from "./auth";
import type { D1Database, D1PreparedStatement, D1Result } from "./types";

/*
	Classroom survey at /cuestionarios/ (separate from the service questionnaires).

	- One group at most is open at a time, enforced by a partial unique index.
	- The open group has a rotating password. It is never stored: D1 only keeps a
	  random `seed`, and the password is an HMAC of it with SESSION_SECRET, so
	  the panel can show it but reading the database alone doesn't reveal it.
	  (A plain hash wouldn't do: nobody could then read a password to hand out.)
	- Every password issued leaves a hash, with no date, in survey_used_passwords,
	  whose primary key makes repeating one impossible.
	- Entering gives a temporary session. Sending the answers copies its course
	  and group into the response and deletes it in the same transaction, so
	  nothing ties a response to a session or a password.

	These tables are created here rather than in server/db.ts so that a problem
	with them can only ever affect the survey, not the rest of the site.
*/

export const COURSES = [1, 2, 3, 4];
export const GROUPS = ["A", "B", "C", "D"];
export const CHOICES = ["securiteu", "euskatronix", "ambos"];

export const REASON_MIN = 3;
export const REASON_MAX = 300;
export const IMPROVEMENT_MAX = 500;
export const MAX_LIMIT = 1000; // highest value for the panel's two access limits

export const SURVEY_COOKIE = "__Host-sd_survey";
const SESSION_TTL_S = 60 * 60;

// Without look-alikes (0/O/Q, 1/I/L, 2/Z, 5/S, 6/G, 8/B), since it's read from
// across a classroom.
const ALPHABET = "ACDEFHJKMNPRTUVWXY34679";
const PASSWORD_LENGTH = 6;

const SCHEMA = [
	// uses_per_password: how many entries a password allows before it rotates
	// (0 = it doesn't rotate). max_accesses: entries allowed for the group in
	// total (0 = no limit). A group can only be open with a seed.
	`CREATE TABLE IF NOT EXISTS survey_groups (
		course INTEGER NOT NULL CHECK (course BETWEEN 1 AND 4),
		grp TEXT NOT NULL CHECK (grp IN ('A', 'B', 'C', 'D')),
		active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
		seed TEXT,
		password_uses INTEGER NOT NULL DEFAULT 0,
		uses_per_password INTEGER NOT NULL DEFAULT 1,
		max_accesses INTEGER NOT NULL DEFAULT 0,
		accesses INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (course, grp),
		CHECK (active = 0 OR seed IS NOT NULL)
	)`,

	// The rule "only one group open on the whole platform", in the database.
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_one_active ON survey_groups (active) WHERE active = 1`,

	`INSERT OR IGNORE INTO survey_groups (course, grp) VALUES
		(1, 'A'), (1, 'B'), (1, 'C'), (1, 'D'), (2, 'A'), (2, 'B'), (2, 'C'), (2, 'D'),
		(3, 'A'), (3, 'B'), (3, 'C'), (3, 'D'), (4, 'A'), (4, 'B'), (4, 'C'), (4, 'D')`,

	// WITHOUT ROWID: rows sort by hash, so not even their order says when.
	`CREATE TABLE IF NOT EXISTS survey_used_passwords (hash TEXT PRIMARY KEY) WITHOUT ROWID`,

	`CREATE TABLE IF NOT EXISTS survey_sessions (
		token_hash TEXT PRIMARY KEY,
		course INTEGER NOT NULL,
		grp TEXT NOT NULL,
		expires_at TEXT NOT NULL
	)`,

	// No IP, no time of day, and nothing pointing at a session or a password.
	`CREATE TABLE IF NOT EXISTS survey_responses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		course INTEGER NOT NULL,
		grp TEXT NOT NULL,
		choice TEXT NOT NULL CHECK (choice IN ('securiteu', 'euskatronix', 'ambos')),
		reason TEXT NOT NULL,
		improvement TEXT NOT NULL DEFAULT '',
		received_on TEXT NOT NULL
	)`,
];

let schemaReady: Promise<unknown> | null = null;

export function ensureSurveySchema(db: D1Database): Promise<unknown> {
	schemaReady ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
		schemaReady = null;
		throw err;
	});
	return schemaReady;
}

// ---------- Passwords ----------

const encoder = new TextEncoder();

async function derivePassword(seed: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`survey-password|${seed}`)));

	let password = "";
	for (const byte of bytes) {
		// Skip the top of the byte range so every character is equally likely.
		if (byte < 230 && password.length < PASSWORD_LENGTH) password += ALPHABET[byte % ALPHABET.length];
	}
	return password;
}

export const currentPassword = (group: SurveyGroup, secret: string) => derivePassword(group.seed ?? "", secret);

export const normalizePassword = (value: unknown) =>
	String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

const usedHash = (password: string, secret: string) => sha256(`survey-used|${password}|${secret}`);

export async function wasIssued(db: D1Database, password: string, secret: string): Promise<boolean> {
	const row = await db.prepare(`SELECT 1 FROM survey_used_passwords WHERE hash = ?`).bind(await usedHash(password, secret)).first();
	return Boolean(row);
}

// Runs a batch that may start using a new password. Its hash is registered
// first, so a repeat aborts the whole transaction and another one is tried.
async function batchWithNewPassword(
	db: D1Database,
	secret: string,
	statements: (seed: string) => D1PreparedStatement[]
): Promise<D1Result[]> {
	for (let attempt = 0; ; attempt++) {
		const seed = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
		const hash = await usedHash(await derivePassword(seed, secret), secret);
		try {
			const results = await db.batch([
				db.prepare(`INSERT INTO survey_used_passwords (hash) VALUES (?)`).bind(hash),
				...statements(seed),
			]);
			return results.slice(1);
		} catch (err) {
			if (attempt >= 3 || !/UNIQUE/i.test(String(err))) throw err;
		}
	}
}

// ---------- Groups ----------

export type SurveyGroup = {
	course: number;
	grp: string;
	active: number;
	seed: string | null;
	password_uses: number;
	uses_per_password: number;
	max_accesses: number;
	accesses: number;
};

export const activeGroup = (db: D1Database) => db.prepare(`SELECT * FROM survey_groups WHERE active = 1`).first<SurveyGroup>();

// Closing the previous group and opening this one is a single transaction.
export function openGroup(db: D1Database, secret: string, course: number, grp: string) {
	return batchWithNewPassword(db, secret, (seed) => [
		db.prepare(`UPDATE survey_groups SET active = 0, seed = NULL, password_uses = 0 WHERE active = 1`),
		db.prepare(`UPDATE survey_groups SET active = 1, seed = ?, password_uses = 0 WHERE course = ? AND grp = ?`).bind(seed, course, grp),
	]);
}

// New entries stop at once; sessions already open can still answer.
export const closeGroups = (db: D1Database) =>
	db.prepare(`UPDATE survey_groups SET active = 0, seed = NULL, password_uses = 0 WHERE active = 1`).run();

export const rotatePassword = (db: D1Database, secret: string) =>
	batchWithNewPassword(db, secret, (seed) => [
		db.prepare(`UPDATE survey_groups SET seed = ?, password_uses = 0 WHERE active = 1`).bind(seed),
	]);

// Consumes one use of the password and opens the session, all or nothing. Both
// statements test the same seed, so of two people using a password at once
// only the first gets in: the seed has already changed for the second.
export async function consumePassword(db: D1Database, secret: string, group: SurveyGroup, tokenHash: string): Promise<boolean> {
	const where = `course = ? AND grp = ? AND active = 1 AND seed = ? AND (max_accesses = 0 OR accesses < max_accesses)`;
	const key = [group.course, group.grp, group.seed];
	const rotates = `uses_per_password > 0 AND password_uses + 1 >= uses_per_password`;

	const [session] = await batchWithNewPassword(db, secret, (seed) => [
		db
			.prepare(
				`INSERT INTO survey_sessions (token_hash, course, grp, expires_at)
					SELECT ?, course, grp, datetime('now', ?) FROM survey_groups WHERE ${where}`
			)
			.bind(tokenHash, `+${SESSION_TTL_S} seconds`, ...key),
		db
			.prepare(
				`UPDATE survey_groups SET
					accesses = accesses + 1,
					seed = CASE WHEN ${rotates} THEN ? ELSE seed END,
					password_uses = CASE WHEN ${rotates} THEN 0 ELSE password_uses + 1 END
					WHERE ${where}`
			)
			.bind(seed, ...key),
	]);

	return session.meta.changes === 1;
}

// ---------- Sessions ----------

const hashToken = (token: string, secret: string) => sha256(`survey|${token}|${secret}`);

export const surveyCookie = (token: string) =>
	`${SURVEY_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=Strict`;

export const clearSurveyCookie = () => `${SURVEY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export async function newSessionToken(secret: string): Promise<{ token: string; tokenHash: string }> {
	const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	return { token, tokenHash: await hashToken(token, secret) };
}

// The hash of this browser's valid session, if it has one.
export async function surveySession(request: Request, db: D1Database, secret: string): Promise<string | null> {
	const token = readCookie(request, SURVEY_COOKIE);
	if (!token || token.length > 100) return null;

	const tokenHash = await hashToken(token, secret);
	const row = await db
		.prepare(`SELECT 1 FROM survey_sessions WHERE token_hash = ? AND expires_at > datetime('now')`)
		.bind(tokenHash)
		.first();
	return row ? tokenHash : null;
}

export const pruneSurveySessions = (db: D1Database) =>
	db.prepare(`DELETE FROM survey_sessions WHERE expires_at <= datetime('now')`).run();

// Stores the answers and ends the session in one transaction: the response only
// takes the course and group, and a second send finds no session to copy from.
export async function saveResponse(
	db: D1Database,
	tokenHash: string,
	answer: { choice: string; reason: string; improvement: string }
): Promise<boolean> {
	const [response] = await db.batch([
		db
			.prepare(
				`INSERT INTO survey_responses (course, grp, choice, reason, improvement, received_on)
					SELECT course, grp, ?, ?, ?, date('now') FROM survey_sessions
					WHERE token_hash = ? AND expires_at > datetime('now')`
			)
			.bind(answer.choice, answer.reason, answer.improvement, tokenHash),
		db.prepare(`DELETE FROM survey_sessions WHERE token_hash = ?`).bind(tokenHash),
	]);

	return response.meta.changes === 1;
}

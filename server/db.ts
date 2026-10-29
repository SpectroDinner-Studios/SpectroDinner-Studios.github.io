import type { D1Database } from "./types";

/*
	One table for every form. `data` holds the exact JSON payload the form sends
	(the same one Make receives). `status`:
	  - reviews:      live → approved / hidden
	                  "live" = on the site, not checked yet; "approved" = checked.
	                  Both are public. "pending" = waiting for approval before
	                  going live (when instant publishing is off in Ajustes).
	  - other forms:  new → read → accepted / rejected  (→ done, for orders)
*/

// The reviews that used to be written into the homepage by hand. They're moved
// into the database once, so they can be hidden or deleted like any other.
// Dates are when each one was added to the site.
const LEGACY_REVIEWS = [
	{ at: "2026-08-19 19:38:32", nickname: "Eggchan00", rating: 5, service: "Helped redesign my discord and built it up", comment: "He was the best person to do it it literally took him less than a day and you guys should try it too" },
	{ at: "2026-08-19 21:36:41", nickname: "COR_braydzYT", rating: 5, service: "discord moderation", comment: "hes so good and fast and kind" },
	{ at: "2026-08-19 22:21:42", nickname: "IVN22", rating: 5, service: "Creación de bot personalizado, remodelación y moderación del servidor de Discord", comment: "De lo mejor que puedes encontrar, muy rápido, perfecto" },
];

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS submissions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		form TEXT NOT NULL,
		status TEXT NOT NULL,
		data TEXT NOT NULL,
		ip_hash TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS idx_submissions_form_status ON submissions (form, status)`,
	`CREATE INDEX IF NOT EXISTS idx_submissions_ip_time ON submissions (ip_hash, created_at)`,

	// Admin sessions: only a salted hash of the cookie token is stored.
	`CREATE TABLE IF NOT EXISTS admin_sessions (
		token_hash TEXT PRIMARY KEY,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		expires_at TEXT NOT NULL,
		last_seen TEXT NOT NULL DEFAULT (datetime('now')),
		user_agent TEXT
	)`,

	// Access log: login_ok | login_fail | logout | revoke_others | revoke_all
	`CREATE TABLE IF NOT EXISTS admin_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		at TEXT NOT NULL DEFAULT (datetime('now')),
		kind TEXT NOT NULL,
		ip_hash TEXT,
		user_agent TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS idx_admin_events_kind_ip ON admin_events (kind, ip_hash, at)`,

	// Site switches changed from the panel's Ajustes tab (see server/settings.ts).
	`CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	// Private notes on a submission, only ever shown in the panel.
	`CREATE TABLE IF NOT EXISTS submission_notes (
		submission_id INTEGER PRIMARY KEY,
		note TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	// What was changed from the panel (shown in Seguridad → Historial).
	`CREATE TABLE IF NOT EXISTS admin_actions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		at TEXT NOT NULL DEFAULT (datetime('now')),
		action TEXT NOT NULL,
		submission_id INTEGER,
		summary TEXT
	)`,

	// Site accounts (separate from the admin login). Passwords are PBKDF2
	// hashes (see server/users.ts); emails are stored lower-cased.
	`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		last_login TEXT,
		disabled INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS user_sessions (
		token_hash TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		expires_at TEXT NOT NULL,
		last_seen TEXT NOT NULL DEFAULT (datetime('now')),
		user_agent TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id)`,

	// One-time "set a new password" links, created from the panel.
	`CREATE TABLE IF NOT EXISTS password_resets (
		token_hash TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		expires_at TEXT NOT NULL
	)`,

	// Rate limiting for sign-up and sign-in: register | login_fail | login_ok
	`CREATE TABLE IF NOT EXISTS user_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		at TEXT NOT NULL DEFAULT (datetime('now')),
		kind TEXT NOT NULL,
		ip_hash TEXT,
		user_id INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_user_events_kind_ip ON user_events (kind, ip_hash, at)`,

	// Support tickets. `submission_id` links the ticket that follows a form
	// sent while signed in. status: open (waiting for us) → answered (waiting
	// for the user) → closed. The unread flags drive the badges on each side.
	`CREATE TABLE IF NOT EXISTS tickets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		submission_id INTEGER,
		category TEXT NOT NULL,
		subject TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'open',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now')),
		user_unread INTEGER NOT NULL DEFAULT 0,
		staff_unread INTEGER NOT NULL DEFAULT 1
	)`,
	`CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets (user_id, updated_at)`,
	`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status, updated_at)`,
	`CREATE INDEX IF NOT EXISTS idx_tickets_submission ON tickets (submission_id)`,

	// author: user | staff | system (system bodies are codes like
	// "status:accepted", shown in the reader's language).
	`CREATE TABLE IF NOT EXISTS ticket_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticket_id INTEGER NOT NULL,
		author TEXT NOT NULL,
		body TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	`CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages (ticket_id, id)`,

	// One-time data jobs that already ran, so they never run twice.
	`CREATE TABLE IF NOT EXISTS migrations (
		name TEXT PRIMARY KEY,
		done_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	...LEGACY_REVIEWS.map(
		(r) => `INSERT INTO submissions (created_at, form, status, data)
			SELECT ${sqlText(r.at)}, 'review', 'approved', ${sqlText(JSON.stringify({ form: "review", nickname: r.nickname, service: r.service, rating: r.rating, comment: r.comment }))}
			WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name = 'legacy-reviews')`
	),
	`INSERT OR IGNORE INTO migrations (name) VALUES ('legacy-reviews')`,
];

// A change made from the panel, for the Historial.
export function logAction(db: D1Database, action: string, submissionId: number | null, summary: string) {
	return db
		.prepare(`INSERT INTO admin_actions (action, submission_id, summary) VALUES (?, ?, ?)`)
		.bind(action, submissionId, summary.slice(0, 240))
		.run();
}

export type SubmissionRow = {
	id: number;
	created_at: string;
	form: string;
	status: string;
	data: string;
};

let schemaReady: Promise<unknown> | null = null;

// Creates the tables on first use, so a fresh D1 database needs no migrations.
export function ensureSchema(db: D1Database): Promise<unknown> {
	schemaReady ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
		schemaReady = null;
		throw err;
	});
	return schemaReady;
}

import type { D1Database } from "./types";

/*
	One table for every form. `data` holds the exact JSON payload the form sends
	(the same one Make receives). `status`:
	  - reviews:      live → approved / hidden
	                  "live" = on the site, not checked yet; "approved" = checked.
	                  Both are public. ("pending" = older reviews that waited for
	                  approval before going live; not public until approved.)
	  - other forms:  new → read
*/
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
];

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

import type { D1Database } from "./types";

/*
	One table for every form. `data` holds the exact JSON payload the form sends
	(the same one Make receives). `status`:
	  - reviews:      pending → approved / hidden   (only "approved" is public)
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

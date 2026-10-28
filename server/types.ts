// Minimal hand-written Cloudflare types for the Pages Functions in /functions.
// Deliberately not `@cloudflare/workers-types`: that package redeclares DOM's
// global `Element`, which breaks type-checking of the site's client scripts.

export interface D1Result<T = Record<string, unknown>> {
	results: T[];
	success: boolean;
	meta: Record<string, unknown>;
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	run(): Promise<D1Result>;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
	batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface Env {
	// D1 binding, added in the Cloudflare dashboard (Pages → Settings → Bindings).
	DB?: D1Database;
	// Secrets (Pages → Settings → Variables and secrets). Never commit them.
	ADMIN_PASSWORD?: string;
	SESSION_SECRET?: string;
	// Optional override; defaults to the Make scenario the site already uses.
	MAKE_WEBHOOK_URL?: string;
}

export interface PagesContext {
	request: Request;
	env: Env;
	params: Record<string, string | string[]>;
	data: Record<string, unknown>;
	next(): Promise<Response>;
	waitUntil(promise: Promise<unknown>): void;
}

export type PagesHandler = (context: PagesContext) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			...headers,
		},
	});
}

// Everything behind the admin login: never cached, indexed, archived or framed.
export const PRIVATE_HEADERS: Record<string, string> = {
	"Cache-Control": "no-store, private",
	"X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
	"Content-Security-Policy": [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'self'",
	].join("; "),
};

// The GitHub Pages copy of the site has no backend: it uses this one for the
// public endpoints (forms, reviews, settings), so both copies stay in sync.
const CORS_ORIGINS = ["https://spectrodinner-studios.github.io"];

export function withCors(request: Request, response: Response): Response {
	const origin = request.headers.get("Origin");
	if (!origin || !CORS_ORIGINS.includes(origin)) return response;
	return withHeaders(response, { "Access-Control-Allow-Origin": origin, Vary: "Origin" });
}

export function corsPreflight(request: Request): Response {
	return withCors(
		request,
		new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
				"Access-Control-Max-Age": "86400",
			},
		})
	);
}

export function withHeaders(response: Response, headers: Record<string, string>): Response {
	const merged = new Headers(response.headers);
	for (const [key, value] of Object.entries(headers)) merged.set(key, value);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

// Parses a JSON object body, rejecting anything that isn't one or is too big.
export async function readJsonObject(
	request: Request,
	maxChars = 20_000
): Promise<Record<string, unknown> | null> {
	if (!request.headers.get("Content-Type")?.includes("application/json")) return null;

	const raw = await request.text();
	if (raw.length > maxChars) return null;

	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

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

import { apiUrl } from "./api";

// The Make scenario every form has always posted to (email notifications).
const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/0k965b8ykue9xfa4wuny31jj5w5liinb";

const postJson = (url: string, payload: unknown) =>
	fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

// A submission the backend refused on purpose: "closed" (form switched off in
// the panel), "rate_limited", or a validation error code.
export class SubmitError extends Error {
	code: string;

	constructor(code: string) {
		super(code);
		this.code = code;
	}
}

/**
 * Sends a form to our backend (/api/submit on Cloudflare Pages), which stores
 * it in D1 and forwards it to Make. Resolves with the stored request id, for
 * reviews whether it went live straight away, and the account ticket if any.
 *
 * When the backend can't be reached it falls back to posting straight to Make,
 * as the site always did (no id in that case). Rejections from a working
 * backend throw a SubmitError.
 */
export async function submitForm(
	payload: Record<string, unknown>
): Promise<{ id?: number; published?: boolean; ticketId?: number }> {
	// The language the form was filled in, so replies can be written in it.
	const body = { ...payload, idioma: document.documentElement.lang === "en" ? "en" : "es" };

	let response: Response | null = null;

	try {
		response = await postJson(apiUrl("/api/submit"), body);
	} catch {
		// Network error reaching the backend: fall through to Make.
	}

	if (response?.ok) {
		const result = (await response.json().catch(() => ({}))) as { id?: unknown; published?: unknown; ticketId?: unknown };
		return {
			id: typeof result.id === "number" ? result.id : undefined,
			published: result.published === true,
			// Sent while signed in: the ticket that follows it in /cuenta.
			ticketId: typeof result.ticketId === "number" ? result.ticketId : undefined,
		};
	}

	if (response && [400, 403, 429].includes(response.status)) {
		const result = (await response.json().catch(() => ({}))) as { error?: unknown };
		throw new SubmitError(typeof result.error === "string" ? result.error : String(response.status));
	}

	const fallback = await postJson(MAKE_WEBHOOK_URL, body);
	if (!fallback.ok) throw new Error("Request failed");
	return {};
}

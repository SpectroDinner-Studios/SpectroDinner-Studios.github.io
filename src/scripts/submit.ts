// The Make scenario every form has always posted to (email notifications).
const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/0k965b8ykue9xfa4wuny31jj5w5liinb";

const postJson = (url: string, payload: unknown) =>
	fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

/**
 * Sends a form to our backend (/api/submit on Cloudflare Pages), which stores
 * it in D1 and forwards it to Make.
 *
 * When there's no backend — the GitHub Pages copy of the site, or D1 not set
 * up yet — it falls back to posting straight to Make, as the site always did.
 * Rejections from a working backend (bad data, rate limit) are real errors.
 */
export async function submitForm(payload: Record<string, unknown>): Promise<void> {
	let response: Response | null = null;

	try {
		response = await postJson("/api/submit", payload);
	} catch {
		// Network error reaching the backend: fall through to Make.
	}

	if (response?.ok) return;

	if (response && (response.status === 400 || response.status === 429)) {
		throw new Error(`Backend rejected the submission (${response.status})`);
	}

	const fallback = await postJson(MAKE_WEBHOOK_URL, payload);
	if (!fallback.ok) throw new Error("Request failed");
}

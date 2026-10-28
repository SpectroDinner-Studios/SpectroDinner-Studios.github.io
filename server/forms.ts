// The four site forms and the fields each one must have. The payload shapes
// come from the client scripts (and are exactly what the Make scenario gets).
const REQUIRED: Record<string, string[]> = {
	review: ["nickname", "comment"],
	discord: ["nombre", "email"],
	minecraft: ["nickname", "email"],
	voluntariado: ["nombre", "email"],
};

export const FORM_IDS = Object.keys(REQUIRED);

const MAX_TEXT = 2000;
const MAX_LIST = 30;

type Clean = Record<string, string | number | string[]>;

// Keeps only plain fields (strings, numbers, string lists) with sane sizes.
function sanitize(payload: Record<string, unknown>): Clean {
	const clean: Clean = {};

	for (const [key, value] of Object.entries(payload)) {
		if (!/^[a-z_]{1,40}$/.test(key)) continue;

		if (typeof value === "string") {
			clean[key] = value.trim().slice(0, MAX_TEXT);
		} else if (typeof value === "number" && Number.isFinite(value)) {
			clean[key] = value;
		} else if (Array.isArray(value)) {
			clean[key] = value
				.filter((item): item is string => typeof item === "string")
				.slice(0, MAX_LIST)
				.map((item) => item.trim().slice(0, 200));
		}
	}

	return clean;
}

export function validateSubmission(
	payload: Record<string, unknown>
): { ok: true; form: string; data: Clean } | { ok: false; error: string } {
	const data = sanitize(payload);
	const form = typeof data.form === "string" ? data.form : "";

	const required = REQUIRED[form];
	if (!required) return { ok: false, error: "unknown_form" };

	for (const field of required) {
		const value = data[field];
		if (typeof value !== "string" || !value) return { ok: false, error: `missing_${field}` };
	}

	if ("email" in data && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) {
		return { ok: false, error: "invalid_email" };
	}

	if (form === "review") {
		const rating = Number(data.rating);
		if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
			return { ok: false, error: "invalid_rating" };
		}
		data.rating = rating;
		data.nickname = String(data.nickname).slice(0, 60);
	}

	return { ok: true, form, data };
}

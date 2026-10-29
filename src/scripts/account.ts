/*
	Shared helpers for the account pages (/entrar, /registro, /cuenta/*).

	Text made here is bilingual the same way <T> is: both languages are
	rendered and the global html[lang] rules show the active one, so the
	language toggle keeps working on content built by scripts.
*/

// Accounts live on the Cloudflare site only (the GitHub Pages copy can't hold
// a session for it), so account pages there send people over.
export const ACCOUNT_ORIGIN = "https://spectrodinner-studios.pages.dev";

export function ensureAccountHost(): void {
	if (location.hostname.endsWith(".github.io")) {
		location.replace(ACCOUNT_ORIGIN + location.pathname + location.search + location.hash);
	}
}

export const signedInHint = () => /(?:^|;\s*)sd_signed_in=1/.test(document.cookie);

// ---------- Bilingual text ----------

export type Pair = readonly [es: string, en: string];

export function tt(es: string, en: string = es): DocumentFragment {
	const fragment = document.createDocumentFragment();
	if (es === en) {
		fragment.append(es);
		return fragment;
	}
	for (const [lang, text] of [["es", es], ["en", en]] as const) {
		const span = document.createElement("span");
		span.dataset.lang = lang;
		span.textContent = text;
		fragment.append(span);
	}
	return fragment;
}

export const pair = ([es, en]: Pair) => tt(es, en);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	node.append(...children);
	return node;
}

// ---------- Dates ----------

const parseDate = (value: string) => new Date(value.replace(" ", "T") + "Z");

function relativeIn(lang: "es" | "en", value: string): string {
	const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
	const seconds = Math.round((parseDate(value).getTime() - Date.now()) / 1000);
	const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
	}
	return lang === "en" ? "just now" : "ahora mismo";
}

export const when = (value: string) => tt(relativeIn("es", value), relativeIn("en", value));

export const fullDate = (value: string) =>
	parseDate(value).toLocaleString(document.documentElement.lang === "en" ? "en-GB" : "es-ES", { dateStyle: "medium", timeStyle: "short" });

export const ref = (id: number) => "#" + String(id).padStart(4, "0");

// ---------- API ----------

// `data.error` is the backend's error code when `ok` is false.
export type ApiResult<T = Record<string, any>> = { ok: boolean; status: number; data: T & { error?: string } };

export async function api<T = Record<string, any>>(path: string, body?: unknown): Promise<ApiResult<T>> {
	try {
		const res = await fetch(path, {
			method: body === undefined ? "GET" : "POST",
			headers: body === undefined ? undefined : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
			credentials: "same-origin",
			cache: "no-store",
		});
		return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as ApiResult<T>["data"] };
	} catch {
		return { ok: false, status: 0, data: { error: "network" } as ApiResult<T>["data"] };
	}
}

export type Account = { id: number; name: string; email: string; created_at: string; unread: number };

export async function currentAccount(): Promise<Account | null> {
	const { data } = await api<{ user: Account | null }>("/api/auth/me");
	return data?.user ?? null;
}

// Only a path on this site is a safe place to go after signing in.
export function safeNext(value: string | null, fallback = "/cuenta/"): string {
	return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("://") ? value : fallback;
}

export const loginUrl = (next = location.pathname + location.search) => "/entrar/?next=" + encodeURIComponent(next);

// For pages that need an account: sends signed-out visitors to /entrar.
export async function requireAccount(): Promise<Account | null> {
	ensureAccountHost();
	const account = await currentAccount();
	if (!account) location.replace(loginUrl());
	return account;
}

// ---------- Messages for the error codes the backend returns ----------

const ERRORS: Record<string, Pair> = {
	invalid_credentials: ["Email o contraseña incorrectos.", "Wrong email or password."],
	locked: ["Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.", "Too many failed attempts. Wait 15 minutes and try again."],
	account_disabled: ["Esta cuenta está desactivada. Escríbenos si crees que es un error.", "This account is disabled. Contact us if you think it's a mistake."],
	email_taken: ["Ya hay una cuenta con ese email. Prueba a entrar.", "There's already an account with that email. Try signing in."],
	email_invalid: ["Escribe un email válido.", "Enter a valid email address."],
	name_invalid: ["Escribe un nombre de al menos 2 caracteres.", "Enter a name with at least 2 characters."],
	password_short: ["La contraseña debe tener al menos 8 caracteres.", "Your password must be at least 8 characters long."],
	password_long: ["La contraseña es demasiado larga.", "That password is too long."],
	password_common: ["Esa contraseña es demasiado fácil de adivinar. Elige otra.", "That password is too easy to guess. Choose another one."],
	password_mismatch: ["Las contraseñas no coinciden.", "The passwords don't match."],
	terms_required: ["Tienes que aceptar el aviso de privacidad.", "You need to accept the privacy notice."],
	rate_limited: ["Has hecho demasiadas peticiones seguidas. Espera un poco y vuelve a probar.", "You've made too many requests in a row. Wait a bit and try again."],
	wrong_password: ["La contraseña actual no es correcta.", "Your current password isn't correct."],
	invalid_token: ["Este enlace ya no es válido. Pídenos uno nuevo.", "This link is no longer valid. Ask us for a new one."],
	subject_short: ["Escribe un asunto un poco más largo.", "Write a slightly longer subject."],
	message_short: ["Escribe tu mensaje.", "Write your message."],
	category_invalid: ["Elige una categoría.", "Choose a category."],
	not_found: ["No encontramos este ticket.", "We couldn't find this ticket."],
	unavailable: ["Las cuentas no están disponibles ahora mismo.", "Accounts aren't available right now."],
	network: ["No se pudo conectar. Revisa tu conexión.", "Couldn't connect. Check your connection."],
};

export const errorText = (code: unknown) => pair(ERRORS[String(code)] ?? ["Algo salió mal. Inténtalo de nuevo.", "Something went wrong. Please try again."]);

export function showAlert(box: HTMLElement, content: Node | null, tone: "error" | "ok" = "error"): void {
	box.replaceChildren();
	if (!content) {
		box.hidden = true;
		return;
	}
	box.className = "acc-alert" + (tone === "ok" ? " is-ok" : "");
	box.append(content);
	box.hidden = false;
}

// ---------- Tickets ----------

export const CATEGORIES: Record<string, { icon: string; label: Pair; hint: Pair }> = {
	soporte: { icon: "🛟", label: ["Soporte general", "General support"], hint: ["Dudas o problemas con cualquier cosa nuestra.", "Questions or problems with anything of ours."] },
	discord: { icon: "💬", label: ["Servicio de Discord", "Discord service"], hint: ["Sobre un servidor que te montamos o vamos a montar.", "About a server we built or will build for you."] },
	minecraft: { icon: "⛏️", label: ["Servicio de Minecraft", "Minecraft service"], hint: ["Permisos, rangos, plugins, rendimiento…", "Permissions, ranks, plugins, performance…"] },
	tep: { icon: "⏱️", label: ["T.E.P. (plugin)", "T.E.P. (plugin)"], hint: ["Errores, dudas o ideas para TimeEconomyPlugin.", "Bugs, questions or ideas for TimeEconomyPlugin."] },
	voluntariado: { icon: "🤝", label: ["Voluntariado", "Volunteering"], hint: ["Sobre tu postulación o cómo ayudar.", "About your application or how to help."] },
	otro: { icon: "✉️", label: ["Otro", "Other"], hint: ["Cualquier otra cosa.", "Anything else."] },
};

export const TICKET_STATUS: Record<string, { label: Pair; tone: string }> = {
	open: { label: ["En espera", "Waiting for us"], tone: "gold" },
	answered: { label: ["Respondido", "Answered"], tone: "green" },
	closed: { label: ["Cerrado", "Closed"], tone: "" },
};

// The steps a request sent through a form goes through.
export const REQUEST_STEPS: [string, Pair][] = [
	["new", ["Recibida", "Received"]],
	["read", ["En revisión", "In review"]],
	["accepted", ["Aceptada", "Accepted"]],
	["done", ["Terminada", "Done"]],
];
export const REJECTED: Pair = ["Rechazada", "Rejected"];

const SYSTEM_TEXT: Record<string, Pair> = {
	"submitted:discord": ["Enviaste el cuestionario del servicio de Discord. Aquí verás cómo avanza y podrás hablar con nosotros.", "You sent the Discord service questionnaire. You'll see its progress here and can talk to us."],
	"submitted:minecraft": ["Enviaste el cuestionario del servicio de Minecraft. Aquí verás cómo avanza y podrás hablar con nosotros.", "You sent the Minecraft service questionnaire. You'll see its progress here and can talk to us."],
	"submitted:voluntariado": ["Enviaste tu postulación al voluntariado. Aquí verás cómo avanza y podrás hablar con nosotros.", "You sent your volunteer application. You'll see its progress here and can talk to us."],
	"status:read": ["Estamos revisando tu solicitud.", "We're reviewing your request."],
	"status:accepted": ["¡Tu solicitud ha sido aceptada! 🎉", "Your request has been accepted! 🎉"],
	"status:rejected": ["Tu solicitud no ha sido aceptada esta vez.", "Your request wasn't accepted this time."],
	"status:done": ["¡Tu encargo está terminado! 🏁", "Your order is done! 🏁"],
	"closed:user": ["Cerraste el ticket.", "You closed the ticket."],
	"closed:staff": ["SpectroDinner cerró el ticket.", "SpectroDinner closed the ticket."],
	"reopened:user": ["Reabriste el ticket.", "You reopened the ticket."],
	"reopened:staff": ["SpectroDinner reabrió el ticket.", "SpectroDinner reopened the ticket."],
};

export const systemText = (code: string) => pair(SYSTEM_TEXT[code] ?? [code, code]);

// ---------- Small UI bits ----------

// The 👁 button next to a password field.
export function wirePasswordToggles(root: ParentNode = document): void {
	root.querySelectorAll<HTMLButtonElement>("[data-toggle-password]").forEach((button) => {
		const input = document.getElementById(button.dataset.togglePassword!) as HTMLInputElement | null;
		if (!input) return;
		button.addEventListener("click", () => {
			const show = input.type === "password";
			input.type = show ? "text" : "password";
			button.setAttribute("aria-pressed", String(show));
		});
	});
}

// The 4-bar strength meter under a new password: length plus variety.
export function wireStrengthMeters(root: ParentNode = document): void {
	root.querySelectorAll<HTMLElement>("[data-meter-for]").forEach((meter) => {
		const input = document.getElementById(meter.dataset.meterFor!) as HTMLInputElement | null;
		input?.addEventListener("input", () => {
			const value = input.value;
			const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
			const level = !value ? 0 : value.length < 8 ? 1 : value.length >= 12 && kinds >= 3 ? 4 : value.length >= 10 && kinds >= 2 ? 3 : 2;
			meter.dataset.level = String(level);
		});
	});
}

export function setBusy(button: HTMLButtonElement, busy: boolean): void {
	button.disabled = busy;
	button.classList.toggle("is-busy", busy);
}

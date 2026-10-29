import { SubmitError, submitForm } from "./submit";

/*
	Step-by-step questionnaire engine for <Wizard> forms.

	Markup contract (see src/components/forms/*):
	  [data-wizard] > form > .wz-step*        one step per section, last one is review
	  [data-field]                            a field wrapper (input/textarea or .wz-choices)
	  [data-show-when="name=a|b"]             only shown while field `name` has value a or b
	  [data-priority]                         counts towards a priority meter (Minecraft)
	  .wz-chip[data-target][data-insert-*]    one-click suggestion for a text field
	  [data-check-name][data-check-values]    button that ticks several checkboxes
*/

type Lang = "es" | "en";
const lang = (): Lang => (document.documentElement.lang === "en" ? "en" : "es");

const MESSAGES = {
	es: {
		required: "Este campo es obligatorio.",
		choose: "Elige una opción.",
		chooseMin: (n: number) => (n === 1 ? "Elige al menos una opción." : `Elige al menos ${n} opciones.`),
		email: "Introduce un email válido.",
		url: "Introduce una URL válida (https://…).",
		step: "Revisa los campos marcados antes de continuar.",
		typo: "¿Quisiste decir",
		fix: "Corregir",
		edit: "Editar",
		emptyStep: "Sin respuestas en este paso.",
		picked: (n: number) => `${n} elegida${n === 1 ? "" : "s"}`,
		closed: "Este formulario está cerrado ahora mismo. Tus respuestas siguen guardadas en este navegador.",
		limited: "Has enviado varias solicitudes seguidas. Espera unos minutos e inténtalo de nuevo.",
	},
	en: {
		required: "This field is required.",
		choose: "Please choose an option.",
		chooseMin: (n: number) => (n === 1 ? "Choose at least one option." : `Choose at least ${n} options.`),
		email: "Enter a valid email address.",
		url: "Enter a valid URL (https://…).",
		step: "Check the highlighted fields before continuing.",
		typo: "Did you mean",
		fix: "Fix it",
		edit: "Edit",
		emptyStep: "No answers in this step.",
		picked: (n: number) => `${n} selected`,
		closed: "This form is closed right now. Your answers are still saved in this browser.",
		limited: "You've sent several requests in a row. Wait a few minutes and try again.",
	},
};

const t = () => MESSAGES[lang()];

// Common email-domain typos → the domain people meant.
const DOMAIN_FIXES: Record<string, string> = {
	"gmial.com": "gmail.com",
	"gmal.com": "gmail.com",
	"gmai.com": "gmail.com",
	"gamil.com": "gmail.com",
	"gnail.com": "gmail.com",
	"gmail.co": "gmail.com",
	"gmail.cm": "gmail.com",
	"gmail.con": "gmail.com",
	"hotmial.com": "hotmail.com",
	"hotmal.com": "hotmail.com",
	"hotmai.com": "hotmail.com",
	"hotmail.co": "hotmail.com",
	"hotmail.con": "hotmail.com",
	"outlok.com": "outlook.com",
	"outloo.com": "outlook.com",
	"outlook.co": "outlook.com",
	"yaho.com": "yahoo.com",
	"yahoo.co": "yahoo.com",
	"iclod.com": "icloud.com",
	"icloud.co": "icloud.com",
	"protonmail.co": "protonmail.com",
	"proton.mi": "proton.me",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const COOLDOWN_MS = 8000;

type Control = HTMLInputElement | HTMLTextAreaElement;

export interface WizardOptions {
	formId: string;
	// Builds the exact payload Make and /api/submit expect.
	buildPayload: (data: FormData) => Record<string, unknown>;
	// Called after every change (e.g. to update a priority meter).
	onChange?: (form: HTMLFormElement) => void;
}

export function initWizard({ formId, buildPayload, onChange }: WizardOptions): void {
	const form = document.getElementById(formId) as HTMLFormElement | null;
	const root = form?.closest<HTMLElement>("[data-wizard]");
	if (!form || !root) return;

	const q = <E extends Element>(selector: string) => root.querySelector<E>(selector);

	const steps = Array.from(form.querySelectorAll<HTMLElement>(".wz-step"));
	const links = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-goto]"));
	const prevBtn = q<HTMLButtonElement>("[data-prev]")!;
	const nextBtn = q<HTMLButtonElement>("[data-next]")!;
	const submitBtn = q<HTMLButtonElement>("[data-submit]")!;
	const stepError = q<HTMLElement>("[data-step-error]")!;
	const submitError = q<HTMLElement>("[data-submit-error]")!;
	const navPos = q<HTMLElement>("[data-nav-pos]")!;
	const progressFill = q<HTMLElement>("[data-progress-fill]")!;
	const progressBar = q<HTMLElement>("[data-progress-bar]")!;
	const progressText = q<HTMLElement>("[data-progress-text]")!;
	const savedBadge = q<HTMLElement>("[data-saved]")!;
	const draftNotice = q<HTMLElement>("[data-draft-notice]")!;
	const review = q<HTMLElement>("[data-review]")!;
	const success = q<HTMLElement>("[data-success]")!;

	const lastStep = steps.length - 1;
	const draftKey = `sd-draft:${formId}`;
	const reducedMotion =
		window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
		document.documentElement.getAttribute("data-reduced-motion") === "true";

	let current = 0;
	let reached = 0;
	let cooling = false;
	let sent = false;

	root.classList.add("is-ready");

	// ---------- Helpers ----------

	const visibleText = (el: Element | null): string => {
		if (!el) return "";
		const localized = el.querySelector(`[data-lang="${lang()}"]`);
		return (localized ?? el).textContent?.replace(/\s+/g, " ").trim() ?? "";
	};

	// Hidden by a [data-show-when] condition — not merely on an inactive step.
	const isShown = (el: Element) => {
		const hidden = el.closest("[hidden]");
		return !hidden || hidden.classList.contains("wz-step");
	};

	const fieldsIn = (step: Element) =>
		Array.from(step.querySelectorAll<HTMLElement>("[data-field]")).filter(isShown);

	const controlOf = (field: HTMLElement) => field.querySelector<Control>("input, textarea");

	const debounce = (fn: () => void, ms: number) => {
		let timer = 0;
		return () => {
			clearTimeout(timer);
			timer = window.setTimeout(fn, ms);
		};
	};

	// ---------- Language-dependent bits ----------

	const applyPlaceholders = () => {
		form.querySelectorAll<Control>("[data-ph-es]").forEach((el) => {
			el.placeholder = (lang() === "en" ? el.dataset.phEn : el.dataset.phEs) ?? "";
		});
	};

	// ---------- Conditional fields ----------

	const updateConditionals = () => {
		const data = new FormData(form);
		root.querySelectorAll<HTMLElement>("[data-show-when]").forEach((el) => {
			const [name, values = ""] = (el.dataset.showWhen ?? "").split("=");
			const allowed = values.split("|");
			el.hidden = !data.getAll(name).some((v) => allowed.includes(String(v)));
		});
	};

	// ---------- Counters & picked badges ----------

	const updateCounters = () => {
		form.querySelectorAll<HTMLElement>("[data-count-for]").forEach((counter) => {
			const control = document.getElementById(counter.dataset.countFor!) as Control | null;
			if (!control) return;
			const length = control.value.length;
			counter.textContent = `${length} / ${control.maxLength}`;
			counter.classList.toggle("near", length > control.maxLength * 0.9);
		});

		form.querySelectorAll<HTMLElement>("[data-picked-for]").forEach((badge) => {
			const n = form.querySelectorAll(`input[name="${badge.dataset.pickedFor}"]:checked`).length;
			badge.hidden = n === 0;
			badge.textContent = t().picked(n);
		});
	};

	// ---------- Validation ----------

	const isValidUrl = (value: string) => {
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	};

	const validateField = (field: HTMLElement): string => {
		if (field.classList.contains("wz-choices")) {
			const min = Number(field.dataset.min ?? 0);
			const checked = field.querySelectorAll("input:checked").length;
			if (checked >= min) return "";
			return field.dataset.type === "radio" ? t().choose : t().chooseMin(min);
		}

		const control = controlOf(field);
		if (!control) return "";

		const value = control.value.trim();
		if (!value) return control.required ? t().required : "";
		if (control.type === "email" && !EMAIL_RE.test(value)) return t().email;
		if (control.type === "url" && !isValidUrl(value)) return t().url;
		return "";
	};

	const setFieldError = (field: HTMLElement, message: string) => {
		field.classList.toggle("has-error", Boolean(message));
		const error = field.querySelector(".field-error");
		if (error) error.textContent = message;
		field.querySelectorAll("input, textarea").forEach((el) => {
			if (message) el.setAttribute("aria-invalid", "true");
			else el.removeAttribute("aria-invalid");
		});
	};

	const validateStep = (index: number, focus = true): boolean => {
		let firstInvalid: HTMLElement | null = null;

		for (const field of fieldsIn(steps[index])) {
			const message = validateField(field);
			setFieldError(field, message);
			firstInvalid ??= message ? field : null;
		}

		stepError.hidden = !firstInvalid;
		stepError.textContent = firstInvalid ? t().step : "";

		if (firstInvalid && focus) {
			firstInvalid.querySelector<HTMLElement>("input, textarea")?.focus();
		}

		return !firstInvalid;
	};

	// ---------- Email typo suggestion ----------

	const suggestEmail = (control: Control) => {
		const box = form.querySelector<HTMLElement>(`[data-suggest-for="${control.id}"]`);
		if (!box) return;

		const [user, domain] = control.value.trim().toLowerCase().split("@");
		const fix = domain ? DOMAIN_FIXES[domain] : undefined;

		if (!user || !fix) {
			box.hidden = true;
			return;
		}

		const suggestion = `${user}@${fix}`;
		const button = document.createElement("button");
		button.type = "button";
		button.className = "wz-link";
		button.textContent = t().fix;
		button.addEventListener("click", () => {
			control.value = suggestion;
			box.hidden = true;
			control.dispatchEvent(new Event("input", { bubbles: true }));
		});

		box.replaceChildren(`${t().typo} `, Object.assign(document.createElement("strong"), { textContent: suggestion }), "? ", button);
		box.hidden = false;
	};

	// ---------- Progress & navigation ----------

	const updateProgress = (percent: number) => {
		progressFill.style.setProperty("--value", `${percent}%`);
		progressBar.setAttribute("aria-valuenow", String(percent));
		progressText.textContent = `${percent}%`;
	};

	const show = (index: number, focus = true) => {
		current = Math.max(0, Math.min(index, lastStep));
		reached = Math.max(reached, current);

		steps.forEach((step, i) => {
			step.hidden = i !== current;
		});

		links.forEach((link, i) => {
			link.disabled = i > reached;
			link.classList.toggle("is-done", i < reached && i !== current);
			if (i === current) link.setAttribute("aria-current", "step");
			else link.removeAttribute("aria-current");
		});

		// On narrow screens the step list is a horizontal strip: keep the current one in view.
		const strip = links[current]?.closest<HTMLElement>(".wz-steps");
		if (strip && strip.scrollWidth > strip.clientWidth) {
			strip.scrollLeft = links[current].offsetLeft - strip.clientWidth / 2;
		}

		const isReview = current === lastStep;

		prevBtn.hidden = current === 0;
		nextBtn.hidden = isReview;
		submitBtn.hidden = !isReview;
		nextBtn.dataset.mode = current === lastStep - 1 ? "review" : "next";
		navPos.textContent = `${current + 1} / ${steps.length}`;
		stepError.hidden = true;
		submitError.hidden = true;

		updateProgress(Math.round((current / lastStep) * 100));

		if (isReview) renderReview();

		if (focus) {
			root.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
			steps[current].querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
		}

		saveDraft();
	};

	prevBtn.addEventListener("click", () => show(current - 1));

	nextBtn.addEventListener("click", () => {
		if (validateStep(current)) show(current + 1);
	});

	links.forEach((link, i) => {
		link.addEventListener("click", () => {
			if (i > reached) return;
			if (i > current && !validateStep(current)) return;
			show(i);
		});
	});

	// Enter in a single-line field moves forward instead of submitting.
	form.addEventListener("keydown", (e) => {
		const target = e.target as HTMLElement;
		if (e.key !== "Enter" || target.tagName !== "INPUT") return;
		if ((target as HTMLInputElement).type === "checkbox" || (target as HTMLInputElement).type === "radio") return;
		e.preventDefault();
		if (current < lastStep) nextBtn.click();
	});

	// ---------- Review ----------

	const describeField = (field: HTMLElement): string => {
		if (field.classList.contains("wz-choices")) {
			return Array.from(field.querySelectorAll<HTMLInputElement>("input:checked"))
				.map((input) => (lang() === "en" ? input.dataset.textEn : input.dataset.textEs) ?? input.value)
				.join(", ");
		}
		return controlOf(field)?.value.trim() ?? "";
	};

	const renderReview = () => {
		const groups = steps.slice(0, lastStep).map((step, i) => {
			const group = document.createElement("article");
			group.className = "wz-review-group";

			const head = document.createElement("div");
			head.className = "wz-review-head";

			const title = document.createElement("h3");
			title.textContent = `${i + 1}. ${visibleText(step.querySelector(".wz-step-title"))}`;

			const edit = document.createElement("button");
			edit.type = "button";
			edit.className = "wz-link";
			edit.textContent = `✎ ${t().edit}`;
			edit.addEventListener("click", () => show(i));

			head.append(title, edit);
			group.append(head);

			const list = document.createElement("dl");
			for (const field of fieldsIn(step)) {
				const value = describeField(field);
				if (!value) continue;
				const label = lang() === "en" ? field.dataset.labelEn : field.dataset.labelEs;
				list.append(
					Object.assign(document.createElement("dt"), { textContent: label ?? "" }),
					Object.assign(document.createElement("dd"), { textContent: value })
				);
			}

			if (list.children.length) group.append(list);
			else group.append(Object.assign(document.createElement("p"), { className: "wz-review-empty", textContent: t().emptyStep }));

			return group;
		});

		review.replaceChildren(...groups);
	};

	// ---------- Draft (localStorage, this browser only) ----------

	const collect = () => {
		const values: Record<string, string | string[]> = {};
		for (const el of Array.from(form.elements) as Control[]) {
			if (!el.name || el.name === "website") continue;
			if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
				if (el.checked) values[el.name] = [...((values[el.name] as string[]) ?? []), el.value];
			} else {
				values[el.name] = el.value;
			}
		}
		return values;
	};

	const saveDraft = debounce(() => {
		// A save still pending from before the submit must not bring the draft back.
		if (sent) return;
		try {
			const values = collect();
			const hasContent = Object.values(values).some((v) => (Array.isArray(v) ? v.length : v.trim()));
			if (!hasContent) {
				localStorage.removeItem(draftKey);
				return;
			}
			localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), step: current, reached, values }));
			savedBadge.hidden = false;
		} catch {}
	}, 400);

	const restoreDraft = (): boolean => {
		try {
			const raw = localStorage.getItem(draftKey);
			if (!raw) return false;

			const draft = JSON.parse(raw) as { at: number; step: number; reached: number; values: Record<string, string | string[]> };
			if (Date.now() - draft.at > DRAFT_TTL_MS) {
				localStorage.removeItem(draftKey);
				return false;
			}

			for (const el of Array.from(form.elements) as Control[]) {
				if (!el.name || !(el.name in draft.values)) continue;
				const value = draft.values[el.name];
				if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
					el.checked = Array.isArray(value) && value.includes(el.value);
				} else if (typeof value === "string") {
					el.value = value;
				}
			}

			current = Math.min(draft.step ?? 0, lastStep);
			reached = Math.min(Math.max(draft.reached ?? 0, current), lastStep);
			draftNotice.hidden = false;
			savedBadge.hidden = false;
			return true;
		} catch {
			return false;
		}
	};

	const clearDraft = () => {
		try {
			localStorage.removeItem(draftKey);
		} catch {}
	};

	q<HTMLButtonElement>("[data-draft-clear]")?.addEventListener("click", () => {
		clearDraft();
		form.reset();
		draftNotice.hidden = true;
		savedBadge.hidden = true;
		form.querySelectorAll<HTMLElement>("[data-field]").forEach((f) => setFieldError(f, ""));
		reached = 0;
		refresh();
		show(0);
	});

	// ---------- Chips & presets ----------

	root.addEventListener("click", (e) => {
		const target = e.target as HTMLElement;

		const chip = target.closest<HTMLButtonElement>(".wz-chip[data-target]");
		if (chip) {
			const control = document.getElementById(chip.dataset.target!) as Control | null;
			if (!control) return;

			const text = (lang() === "en" ? chip.dataset.insertEn : chip.dataset.insertEs) ?? "";
			const existing = control.value.trimEnd();
			const mode = chip.dataset.mode;

			if (mode === "replace" || !existing) control.value = text;
			else if (!existing.split(/\n|,\s*/).includes(text)) {
				control.value = mode === "list" ? `${existing}, ${text}` : `${existing}\n${text}`;
			}

			if (control.maxLength > 0) control.value = control.value.slice(0, control.maxLength);
			control.dispatchEvent(new Event("input", { bubbles: true }));
			control.focus();
			return;
		}

		const preset = target.closest<HTMLButtonElement>("[data-check-name]");
		if (preset) {
			const values = (preset.dataset.checkValues ?? "").split("|");
			form.querySelectorAll<HTMLInputElement>(`input[name="${preset.dataset.checkName}"]`).forEach((input) => {
				if (values.includes(input.value)) input.checked = true;
			});
			form.dispatchEvent(new Event("change"));
		}
	});

	// ---------- Live updates ----------

	const refresh = () => {
		updateConditionals();
		updateCounters();
		onChange?.(form);
	};

	const handleEdit = (e: Event) => {
		const field = (e.target as HTMLElement).closest<HTMLElement>("[data-field]");
		// Once a field has shown an error, re-check it as the user fixes it.
		if (field?.classList.contains("has-error")) setFieldError(field, validateField(field));
		refresh();
		saveDraft();
	};

	form.addEventListener("input", handleEdit);
	form.addEventListener("change", handleEdit);

	form.addEventListener("focusout", (e) => {
		const control = e.target as Control;
		if (control.type === "email") suggestEmail(control);
	});

	window.addEventListener("sd-langchange", () => {
		applyPlaceholders();
		updateCounters();
		if (current === lastStep) renderReview();
		if (!stepError.hidden) stepError.textContent = t().step;
	});

	// ---------- Submit ----------

	const setSubmitting = (submitting: boolean) => {
		submitBtn.disabled = submitting;
		submitBtn.querySelector(".submit-label")?.toggleAttribute("hidden", submitting);
		submitBtn.querySelector(".submit-loading")?.toggleAttribute("hidden", !submitting);
	};

	const showSuccess = (id?: number) => {
		sent = true;
		clearDraft();
		form.hidden = true;
		draftNotice.hidden = true;
		success.hidden = false;

		links.forEach((link) => {
			link.disabled = true;
			link.classList.add("is-done");
			link.removeAttribute("aria-current");
		});
		updateProgress(100);

		const ref = q<HTMLElement>("[data-ref]")!;
		if (id) {
			q<HTMLElement>("[data-ref-value]")!.textContent = `#${String(id).padStart(4, "0")}`;
			ref.hidden = false;
		}

		root.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
		q<HTMLElement>("[data-success-title]")?.focus({ preventScroll: true });
	};

	q<HTMLButtonElement>("[data-again]")?.addEventListener("click", () => {
		clearDraft();
		location.reload();
	});

	form.addEventListener("submit", async (e) => {
		e.preventDefault();

		if (current !== lastStep) {
			nextBtn.click();
			return;
		}
		if (cooling) return;

		submitError.hidden = true;

		const honeypot = form.elements.namedItem("website") as HTMLInputElement | null;
		if (honeypot?.value) {
			clearDraft();
			showSuccess();
			return;
		}

		for (let i = 0; i < lastStep; i++) {
			if (!validateStep(i, false)) {
				show(i);
				validateStep(i);
				return;
			}
		}

		setSubmitting(true);
		cooling = true;

		try {
			const result = await submitForm(buildPayload(new FormData(form)));
			clearDraft();
			showSuccess(result.id);
		} catch (err) {
			const code = err instanceof SubmitError ? err.code : "";
			if (code === "closed" || code === "rate_limited") {
				stepError.textContent = code === "closed" ? t().closed : t().limited;
				stepError.hidden = false;
			} else {
				submitError.hidden = false;
			}
		} finally {
			setSubmitting(false);
			setTimeout(() => {
				cooling = false;
			}, COOLDOWN_MS);
		}
	});

	// ---------- Start ----------

	applyPlaceholders();
	const restored = restoreDraft();
	refresh();
	show(restored ? current : 0, false);
}

import type { Env } from "./types";

// Tells TICKETS_WEBHOOK_URL (if set) that a ticket needs a reply, without
// delaying the visitor's response.
export function notifyTicket(
	env: Env,
	waitUntil: (promise: Promise<unknown>) => void,
	request: Request,
	event: { type: "ticket_opened" | "ticket_reply"; id: number; subject: string; category: string; name: string; email: string; message: string }
): void {
	if (!env.TICKETS_WEBHOOK_URL) return;

	waitUntil(
		fetch(env.TICKETS_WEBHOOK_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...event, panel: new URL("/admin/", request.url).toString() }),
		}).catch(() => undefined)
	);
}

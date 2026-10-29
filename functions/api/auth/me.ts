import { readCookie } from "../../../server/auth";
import { json, withCookies } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import { HINT_COOKIE, clearUserCookies, getUser } from "../../../server/users";

// GET → { user } for the signed-in account (with its unread tickets), or
// { user: null }. A leftover "signed in" hint is cleared so pages stop
// showing "Mi cuenta" after the session ended.
export const onRequestGet: PagesHandler = async ({ request, env }) => {
	const db = env.DB!;
	const user = await getUser(request, db, env.SESSION_SECRET!);

	if (!user) {
		const reply = json({ user: null });
		return readCookie(request, HINT_COOKIE) ? withCookies(reply, clearUserCookies()) : reply;
	}

	const unread = await db
		.prepare(`SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND user_unread = 1`)
		.bind(user.id)
		.first<{ n: number }>();

	return json({
		user: { id: user.id, name: user.name, email: user.email, created_at: user.created_at, unread: unread?.n ?? 0 },
	});
};

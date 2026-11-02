import { FRIENDS_PER_GAME, NEW_ACCOUNT_HOURS, getGames, getProgress } from "../../../server/games";
import { json } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import type { UserSession } from "../../../server/users";

// GET ?token=… → what the invitation page shows: who invited you, which game
// they're unlocking and how far they are. Plus whether you can still confirm.
export const onRequestGet: PagesHandler = async ({ request, env, data }) => {
	const db = env.DB!;
	const token = new URL(request.url).searchParams.get("token") ?? "";
	if (!token || token.length > 64) return json({ error: "invalid_invite" }, 404);

	const invite = await db
		.prepare(`SELECT i.user_id, u.name FROM invites i JOIN users u ON u.id = i.user_id WHERE i.token = ? AND u.disabled = 0`)
		.bind(token)
		.first<{ user_id: number; name: string }>();
	if (!invite) return json({ error: "invalid_invite" }, 404);

	const [progress, games] = await Promise.all([getProgress(db, invite.user_id), getGames(db)]);
	const game = progress.current ? games[progress.current - 1] : null;

	const user = data.user as UserSession | null;
	let viewer: Record<string, unknown> | null = null;
	if (user) {
		const confirmed = await db.prepare(`SELECT 1 FROM invite_confirmations WHERE friend_id = ?`).bind(user.id).first();
		const fresh = await db
			.prepare(`SELECT created_at > datetime('now', ?) AS fresh FROM users WHERE id = ?`)
			.bind(`-${NEW_ACCOUNT_HOURS} hours`, user.id)
			.first<{ fresh: number }>();
		viewer = { name: user.name, own: user.id === invite.user_id, confirmed: Boolean(confirmed), fresh: Boolean(fresh?.fresh) };
	}

	return json({
		inviter: invite.name.split(" ")[0],
		slot: progress.current,
		game: game ? { title: game.title, icon: game.icon } : null,
		count: progress.current ? progress.counts[progress.current - 1] : FRIENDS_PER_GAME,
		needed: FRIENDS_PER_GAME,
		viewer,
	});
};

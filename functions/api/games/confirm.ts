import { timingSafeEqual } from "../../../server/auth";
import { FRIENDS_PER_GAME, NEW_ACCOUNT_HOURS, getProgress, normalizeCode, sameNetwork } from "../../../server/games";
import { json, readJsonObject } from "../../../server/http";
import type { PagesHandler } from "../../../server/types";
import { type UserSession, countEvents, logUserEvent, userIp } from "../../../server/users";

const MAX_WRONG_CODES_PER_HOUR = 10;

// POST { token, code } → the signed-in (new) account confirms whoever invited
// it, which counts towards the game that person is unlocking now.
export const onRequestPost: PagesHandler = async ({ request, env, data }) => {
	const db = env.DB!;
	const friend = data.user as UserSession | null;
	if (!friend) return json({ error: "unauthorized" }, 401);

	const body = await readJsonObject(request, 500);
	const token = String(body?.token ?? "");

	const invite = token && token.length <= 64
		? await db
				.prepare(`SELECT i.user_id, i.code, u.name FROM invites i JOIN users u ON u.id = i.user_id WHERE i.token = ? AND u.disabled = 0`)
				.bind(token)
				.first<{ user_id: number; code: string; name: string }>()
		: null;
	if (!invite) return json({ error: "invalid_invite" }, 404);
	if (invite.user_id === friend.id) return json({ error: "own_invite" }, 400);

	if (await db.prepare(`SELECT 1 FROM invite_confirmations WHERE friend_id = ?`).bind(friend.id).first()) {
		return json({ error: "already_confirmed" }, 409);
	}

	const fresh = await db
		.prepare(`SELECT created_at > datetime('now', ?) AS fresh FROM users WHERE id = ?`)
		.bind(`-${NEW_ACCOUNT_HOURS} hours`, friend.id)
		.first<{ fresh: number }>();
	if (!fresh?.fresh) return json({ error: "not_new_account" }, 403);

	const ip = await userIp(request, env.SESSION_SECRET!);
	if ((await countEvents(db, "invite_fail", 60, { userId: friend.id })) >= MAX_WRONG_CODES_PER_HOUR) {
		return json({ error: "rate_limited" }, 429);
	}
	if (!timingSafeEqual(normalizeCode(body?.code), invite.code)) {
		await logUserEvent(db, "invite_fail", ip, friend.id);
		return json({ error: "invalid_code" }, 400);
	}

	const progress = await getProgress(db, invite.user_id);
	if (!progress.current) return json({ error: "all_unlocked" }, 409);

	try {
		await db
			.prepare(`INSERT INTO invite_confirmations (inviter_id, slot, friend_id, same_network) VALUES (?, ?, ?, ?)`)
			.bind(invite.user_id, progress.current, friend.id, (await sameNetwork(db, invite.user_id, friend.id, ip)) ? 1 : 0)
			.run();
	} catch {
		return json({ error: "already_confirmed" }, 409); // confirmed a moment ago
	}

	const count = progress.counts[progress.current - 1] + 1;
	return json({
		ok: true,
		inviter: invite.name.split(" ")[0],
		slot: progress.current,
		count,
		needed: FRIENDS_PER_GAME,
		unlocked: count >= FRIENDS_PER_GAME,
	});
};

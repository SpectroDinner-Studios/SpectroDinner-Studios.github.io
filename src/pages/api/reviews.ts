import type { APIRoute } from "astro";

export const prerender = false;

interface ReviewPayload {
	discordUser: string;
	service?: string;
	rating: number;
	comment: string;
}

export const POST: APIRoute = async ({ request }) => {
	let body: Partial<ReviewPayload>;

	try {
		body = await request.json();
	} catch {
		return new Response(
			JSON.stringify({ success: false, error: "Invalid JSON body" }),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const discordUser = (body.discordUser ?? "").toString().trim();
	const service = (body.service ?? "").toString().trim();
	const comment = (body.comment ?? "").toString().trim();
	const rating = Number(body.rating);

	if (!discordUser || !comment || !Number.isInteger(rating) || rating < 1 || rating > 5) {
		return new Response(
			JSON.stringify({
				success: false,
				error: "Missing or invalid fields: discordUser, comment and rating (1-5) are required.",
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } }
		);
	}

	const review = {
		discordUser,
		service: service || null,
		rating,
		comment,
		createdAt: new Date().toISOString(),
	};

	// --------------------------------------------------------------------
	// TODO: persist `review` to a real database here, e.g.:
	//   - Vercel Postgres / Neon / Supabase via an ORM (Prisma, Drizzle)
	//   - Vercel KV / Upstash Redis for a lightweight key-value store
	// Example (Prisma):
	//   await prisma.review.create({ data: review });
	// Until then, this only logs the review so the endpoint can be
	// verified end-to-end from the frontend.
	// --------------------------------------------------------------------
	console.log("New review received:", review);

	return new Response(JSON.stringify({ success: true, review }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
};

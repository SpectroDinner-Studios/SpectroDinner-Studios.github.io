const encoder = new TextEncoder();

export const SESSION_COOKIE = "sd_admin";
const SESSION_TTL_S = 60 * 60 * 24 * 7; // 7 days

function toBase64Url(bytes: ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

export async function sha256(value: string): Promise<string> {
	return toBase64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return result === 0;
}

export async function createSessionCookie(secret: string): Promise<string> {
	const expires = String(Date.now() + SESSION_TTL_S * 1000);
	const token = `${expires}.${await hmac(secret, expires)}`;
	return `${SESSION_COOKIE}=${token}; Path=/api/admin; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(): string {
	return `${SESSION_COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(request: Request, name: string): string | undefined {
	const header = request.headers.get("Cookie") ?? "";
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return undefined;
}

export async function isAuthenticated(request: Request, secret: string | undefined): Promise<boolean> {
	// Without a secret every signature would be forgeable — never accept a session.
	if (!secret) return false;

	const token = readCookie(request, SESSION_COOKIE);
	if (!token) return false;

	const [expires, signature] = token.split(".");
	if (!expires || !signature) return false;

	if (!timingSafeEqual(await hmac(secret, expires), signature)) return false;

	const expiresAt = Number(expires);
	return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

# SpectroDinner™

Astro static site, deployed twice from `main`:

- **Cloudflare Pages** — `spectrodinner-studios.pages.dev`, with the backend in [`functions/`](functions).
- **GitHub Pages** — `spectrodinner-studios.github.io`, static only (no `/api`).

## Development

```bash
npm install
npm run dev
```

## Backend (Cloudflare Pages Functions + D1)

- `POST /api/submit` — every site form (reviews, Discord, Minecraft, volunteering) is stored in D1 and forwarded to the existing Make scenario.
- `GET /api/reviews` — reviews approved in the admin panel, shown on the homepage next to the hard-coded ones.
- `/admin` — password-protected panel to read submissions and publish/hide reviews.

If the backend isn't reachable (GitHub Pages, or D1 not set up yet) the forms post straight to Make, so nothing breaks. Tables are created automatically on first use — no migrations.

### One-time Cloudflare setup

In the Cloudflare dashboard:

1. **Storage & databases → D1 → Create** a database (e.g. `spectrodinner-db`).
2. **Workers & Pages → spectrodinner-studios → Settings → Bindings → Add → D1 database**: variable name `DB`, pick that database (for Production and Preview).
3. **Settings → Variables and secrets → Add**, type **Secret**:
   - `ADMIN_PASSWORD` — the admin panel password.
   - `SESSION_SECRET` — a long random string (e.g. from a password manager).
4. **Deployments → Retry deployment** (bindings only apply to new deployments).

Then open `https://spectrodinner-studios.pages.dev/admin`.

### Testing the backend locally

```bash
npm run build
npx wrangler@4 pages dev dist --d1 DB=spectrodinner-local
```

with a git-ignored `.dev.vars` next to `package.json`:

```
ADMIN_PASSWORD=some-local-password
SESSION_SECRET=some-long-random-string
MAKE_WEBHOOK_URL=http://127.0.0.1:9/off   # don't send local tests to Make
```

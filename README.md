# SpectroDinner™

Astro static site, deployed twice from `main`:

- **Cloudflare Pages** — `spectrodinner-studios.pages.dev`, with the backend in [`functions/`](functions).
- **GitHub Pages** — `spectrodinner-studios.github.io`, static only: its pages call the Cloudflare backend (allowed by CORS for that origin only), so both copies share reviews, settings and the panel.

## Development

```bash
npm install
npm run dev
```

## Backend (Cloudflare Pages Functions + D1)

- `POST /api/submit` — every site form (reviews, Discord, Minecraft, volunteering) is stored in D1, with the language it was filled in, and forwarded to the existing Make scenario.
- `GET /api/reviews` — every review on the homepage (the ones that used to be hard-coded were moved into D1 once, so they can be deleted too). New ones go live as soon as they're sent (max 3 per visitor a day) and are moderated afterwards: hiding or deleting one in `/admin` removes it from the site at once (the list is never cached, and open pages re-check every minute).
- `GET /api/settings` and `/config.json` — the switches from **Ajustes**: volunteering open/closed, reviews instant or held for approval, maintenance mode.
- `/admin` — private panel. Login is at `/acceso`.
  - Requests and volunteer applications: **Aceptar / Rechazar** (and **Terminado** for orders), with a reply email already written for each case, in Spanish or English.
  - Private notes on any submission, search, filters and CSV export.
  - **Revisar la web** opens the site beside the panel, with moderation buttons on every review.
  - **Seguridad**: open sessions, access log and a history of every change made from the panel.

If the backend can't be reached the forms post straight to Make, so nothing breaks. Tables are created automatically on first use — no migrations.

### One-time Cloudflare setup

In the Cloudflare dashboard:

1. **Storage & databases → D1 → Create** a database (e.g. `spectrodinner-db`).
2. **Workers & Pages → spectrodinner-studios → Settings → Bindings → Add → D1 database**: variable name `DB`, pick that database (for Production and Preview).
3. **Settings → Variables and secrets → Add**, type **Secret**:
   - `ADMIN_PASSWORD` — the admin panel password.
   - `SESSION_SECRET` — a long random string (e.g. from a password manager).
4. **Deployments → Retry deployment** (bindings only apply to new deployments).

Then open `https://spectrodinner-studios.pages.dev/acceso`.

### How the admin panel stays private

- The panel page only exists in Cloudflare builds (`CF_PAGES` is set there). GitHub Pages and every public asset contain none of its code.
- [`functions/admin/[[path]].ts`](functions/admin/%5B%5Bpath%5D%5D.ts) serves `/admin` only to a valid session. Anyone else — person, crawler or AI — gets a redirect to `/acceso` and never receives a byte of the panel or its data.
- Sessions are stored server-side in D1 (the cookie holds a random token; only its hash is stored). They last 12 h, end after 2 h idle (30 min in the open panel) and can be closed from **Seguridad**.
- 5 wrong passwords from one IP lock it out for 15 min; 30 wrong passwords in an hour from anywhere lock the login for everyone.
- Every login, failure and logout is in the access log (**Seguridad** tab).
- Changing `ADMIN_PASSWORD` doesn't sign out open sessions: press **Cerrar todas** in **Seguridad** (or change `SESSION_SECRET`, which invalidates them all).

### Testing the backend locally

```bash
ADMIN_BUILD=1 npm run build   # include the admin panel, as Cloudflare does
npx wrangler@4 pages dev dist --d1 DB=spectrodinner-local
```

with a git-ignored `.dev.vars` next to `package.json`:

```
ADMIN_PASSWORD=some-local-password
SESSION_SECRET=some-long-random-string
MAKE_WEBHOOK_URL=http://127.0.0.1:9/off   # don't send local tests to Make
```

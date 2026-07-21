# iglidhima Arcade

A single-page, static, browser-based arcade hub served at
[iglidhima.com](https://iglidhima.com). It presents a hub of four original
arcade games — displayed as Tetris, Snake, Pac-Man, and Brick Buster (the
display names for the original in-house implementations) — that run
entirely in the browser. There is no backend, database, account system, or
personal-data collection: all state (per-game high scores) lives in the
visitor's `localStorage`.

Built with [Vite](https://vite.dev/) + [TypeScript](https://www.typescriptlang.org/),
producing a static `dist/` bundle.

## Local development

```bash
npm install
npm run dev        # start the Vite dev server with HMR
npm run build      # type-check + produce the static dist/ bundle
npm run preview    # preview the production build locally
npm test           # run unit + property tests (Vitest)
npm run test:e2e   # run Playwright integration/accessibility tests
```

## Voting

Each game shows two independent global reactions — a 👍 **Like** and a ❤️
**Love** — each with its own worldwide count shared across all visitors. A
visitor can toggle each reaction on or off (one like and one love per game per
browser).

- **Backend.** A small Cloudflare Worker (`src/worker/index.ts`) exposes a
  same-origin JSON API backed by a KV namespace:
  - `GET /api/votes` returns the aggregate `{ like, love }` counts for all four
    games.
  - `POST /api/vote` with `{ gameId, reaction, delta }` (`reaction` is `like` or
    `love`, `delta` is `1` or `-1`) applies the change, clamps the count at
    zero, and returns the game's updated counts.
  Every other route is delegated to the static-assets binding, so the SPA is
  served exactly as before.
- **Anonymous.** Only aggregate integer counts live in KV — no personal data is
  collected. Whether *this* browser has liked/loved a game is remembered in
  `localStorage` (keys `iglidhima.arcade.vote.<gameId>.<reaction>`), which only
  drives the pressed state of the buttons.
- **Consistency.** KV is eventually consistent and has no atomic increment, so
  the counter uses read-modify-write. Concurrent votes can occasionally lose an
  increment — acceptable for a low-traffic likes counter.

### KV namespace setup (required before deploying)

The KV namespace id in `wrangler.jsonc` is a **placeholder**
(`PLACEHOLDER_KV_ID_REPLACE_ME`). Before deploying you must create a real
namespace and paste its id in:

```bash
npx wrangler kv namespace create VOTES
```

Copy the printed `id` value over `PLACEHOLDER_KV_ID_REPLACE_ME` in the
`kv_namespaces` binding of `wrangler.jsonc`. `wrangler deploy` will fail until a
valid namespace id is set.

## Deployment (Cloudflare Pages)

The site deploys automatically to [Cloudflare Pages](https://pages.cloudflare.com/)
from the connected Git repository. No deployment, DNS, or TLS steps are
performed from this repository; only the in-repo build config and redirect
artifact live here.

### Pages project settings

Connect the Git repository to a Cloudflare Pages project and configure:

| Setting                | Value           |
| ---------------------- | --------------- |
| Production branch      | `main`          |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Framework preset       | None / Vite     |

When source changes are pushed to `main`, Cloudflare Pages runs the build
command and publishes the `dist/` output to its global edge network. Deploys
are atomic: if a build fails, the previously published deployment stays live
(Requirement 11.2). Static assets are served over HTTPS with compression
enabled by the platform (Requirements 10.3, 11.3, 11.4).

### Custom domain

In the Pages project under **Custom domains**, add both:

1. `iglidhima.com` (apex / canonical)
2. `www.iglidhima.com`

Cloudflare DNS resolves both names to the Pages project and provisions a valid
TLS certificate automatically (Requirements 12.1, 12.4). HTTP requests are
redirected to HTTPS by the platform (Requirement 12.3).

### Redirects

The canonical `www` -> apex redirect (Requirement 12.2) is configured as a
Cloudflare **Redirect Rule** at the domain level (Rules -> Redirect Rules),
not as a `_redirects` file. Workers static assets only allow relative URLs in
`_redirects`, so a cross-hostname `www.iglidhima.com` -> `iglidhima.com` rule
must live in a domain-level Redirect Rule instead.

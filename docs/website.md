# The website

`apps/web` is dalliance.io: a landing page, a privacy page, a 404, a route that logs each download and redirects to the latest installer, and the sign-in pages for Dalliance accounts with the `/api/auth` proxy behind them. It uses Next.js 16 with the App Router and Tailwind v4. Only the sign-in pages fetch data on the client.

```bash
pnpm --filter @dalliance/web dev     # http://localhost:3100
pnpm --filter @dalliance/web build
pnpm --filter @dalliance/web start   # serve the build on 3100
```

## Layout

```
src/app/
  page.tsx               the home page: masthead, live cell, reel, bands
  privacy/page.tsx       the privacy page
  download/route.ts      logs the download, then redirects to the installer
  api/auth/[...all]/     proxies Better Auth to the Convex deployment. See accounts.md
  sign-in/page.tsx       the sign-in page the desktop app opens
  sign-in/done/          hands the finished sign-in back to the app
  not-found.tsx          404
  layout.tsx             fonts, metadata, viewport colours
  globals.css            palette, @theme, hatching and the hero's animations
  sitemap.ts, robots.ts, manifest.ts
  icon.svg, apple-icon.tsx, favicon.ico
  opengraph-image.tsx, twitter-image.tsx   both render socialCard()
src/components/
  Chrome.tsx             SiteHeader, Band, Act (the download button), SiteFooter
  LiveCell.tsx           the animated cell in the hero
  Reel.tsx               the scrolling screenshot strip with its ledger
  StickyBar.tsx          the top bar that sticks once it reaches the top
  Wordmark.tsx           the pixel mark and the name
src/lib/
  site.ts                name, copy, URLs, colours. Change copy here first
  auth/                  the Better Auth client and the sign-in methods on offer
  ui.ts                  shared class groups: sheet, gutter, label, button, headline
  card.tsx               the 1200 by 630 social card
src/assets/shots/        light and dark captures of the app
```

## Configuration

| Variable | Default | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://dalliance.io` | Canonical links, sitemap, robots, social cards |
| `DALLIANCE_DOWNLOAD_URL` | The `Dalliance.dmg` on the latest GitHub release | Where `/download` redirects |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Unset | The Redis store for the download log. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too |

The sign-in variables, `CONVEX_SITE_URL`, `AUTH_PROXY_SECRET` and `AUTH_METHODS`, are listed in [accounts.md](accounts.md#configuration). Like the Redis pair, they are read at request time.

The first two are read at build time. `turbo.json` lists them in the build task's `env`, so changing one busts the cache. The Redis pair is only read when `/download` runs, so it stays out of `turbo.json`. `site.ts` and the route read them with `||` rather than `??`, because Vercel lets a variable be set but empty.

Every download button links to `/download`, with `?from=` naming the button: `bar` for the top bar, `hero` and `end` for the two on the home page. `download/route.ts` answers it with a temporary redirect, not a permanent one, so moving the installer only means changing the variable. `robots.ts` disallows `/download`, `/sign-in` and `/api/`, and the sign-in pages set `noindex`. The config also sets `nosniff`, `DENY` framing, a strict referrer policy and a permissions policy on every route.

## Analytics

`layout.tsx` renders `<Analytics />` from `@vercel/analytics/next`, which counts page views without cookies. It only sends data from a Vercel deployment with Web Analytics turned on in the project's dashboard, never from `next dev` or a local `next start`. There are no custom events.

### Download log

This is a stopgap until downloads are counted somewhere better. `download/route.ts` pushes one JSON entry per download onto the `downloads` list in an Upstash Redis store, added from the Vercel Marketplace. It writes in `after()`, once the redirect has gone out, so a slow or failed write never delays the download. Bots are skipped, and so is everything when the Redis variables are unset, which covers `next dev`.

Each entry holds `t` (ISO time), `from`, `country`, `region`, `city`, `referrer`, `browser`, `os` and `device`. `referrer` is the page path when the click came from the site, otherwise only the other site's host. No IP is stored.

The store is `dalliance-downloads`, on Upstash's free plan. To read the log, use the Data Browser in the Upstash console, or pull the variables with the Vercel CLI and call the REST API with the read-only token:

```bash
vercel link --yes --project dalliance
vercel env pull .env.local --yes
(set -a; . ./.env.local; set +a; curl -s -H "Authorization: Bearer $KV_REST_API_READ_ONLY_TOKEN" "$KV_REST_API_URL/lrange/downloads/0/-1")
```

`.env.local` holds the store's tokens, so it must stay out of git.

The log only sees clicks that go through the site. The download count on the GitHub release also includes direct links, so it will always be higher.

## Design

The site shares its palette and type with the app, so the page and the screenshots match. `globals.css` copies the app's light and dark colours from `apps/desktop/src/index.css` into its own tokens: `--paper`, `--ink`, `--hairline`, `--brand` and the rest. Utilities read them through `@theme`, so they flip with the system theme without `dark:` on every class. When you change an app colour that the site shows, change it in both files.

Every page follows one grammar: a ruled sheet of warm paper, hairline bands, and short uppercase labels in a 200 px left margin. `Band` in `Chrome.tsx` draws one section. Keep band labels to one line. Shared class groups are in `lib/ui.ts`, so a change to the gutter or the button happens once.

`LiveCell` plays once when it scrolls into view. The prompt types itself, the agent works, then the chart and answer land. With reduced motion it renders finished. The server renders it finished too, and CSS hides that state until hydration.

## Screenshots

The reel on the home page and the repo README use the same twelve files in `src/assets/shots/`: six scenes, each as `<scene>-light.png` and `<scene>-dark.png`, at 3200 by 2000.

To recapture:

1. Build the renderer and serve it with `vite preview`. See [development.md](development.md#looking-at-the-ui-without-electron).
2. Open `/?demo` in a 1600 by 1000 window at 2x, once in light mode and once in dark.
3. Capture each scene:

| Scene | What's on screen |
| --- | --- |
| `answer` | The "Median survival and 2-year survival by arm" cell |
| `ask` | The last cell after pressing Run, with the agent asking how to count patients who switched arms |
| `guess` | An underlined assumption being corrected |
| `code` | That cell's Code tab |
| `history` | The History pane, Cmd+3 |
| `models` | The model picker open |

The demo notebook lives in `apps/desktop/src/dev/demo.ts`. Change it there if a scene needs different data.

## Privacy page

The privacy page lists what the site counts through Vercel Web Analytics, what the download log records, and what an account keeps, and says the app sends no telemetry and keeps work on the user's Mac. Update it in the same change if any of that stops being true, for example if you add a field to the download log, a field to the user or session tables, custom analytics events, or telemetry in the app.

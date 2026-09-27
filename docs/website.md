# The website

`apps/web` is dalliance.io: a landing page, a privacy page, a 404, and a redirect to the latest installer. It uses Next.js 16 with the App Router and Tailwind v4, and has no client data fetching.

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
  ui.ts                  shared class groups: sheet, gutter, label, button, headline
  card.tsx               the 1200 by 630 social card
src/assets/shots/        light and dark captures of the app
```

## Configuration

Both variables are read at build time. `turbo.json` lists them in the build task's `env`, so changing one busts the cache.

| Variable | Default | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://dalliance.io` | Canonical links, sitemap, robots, social cards |
| `DALLIANCE_DOWNLOAD_URL` | The `Dalliance.dmg` on the latest GitHub release | Where `/download` redirects |

`site.ts` reads them with `||` rather than `??`, because Vercel lets a variable be set but empty.

Every download button links to `/download`. The redirect lives in `next.config.ts` and is temporary, not permanent, so moving the installer only means changing the variable. `robots.ts` disallows `/download`. The config also sets `nosniff`, `DENY` framing, a strict referrer policy and a permissions policy on every route.

## Analytics

`layout.tsx` renders `<Analytics />` from `@vercel/analytics/next`, which counts page views without cookies. It only sends data from a Vercel deployment with Web Analytics turned on in the project's dashboard, never from `next dev` or a local `next start`. There are no custom events.

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

The privacy page lists what the site counts through Vercel Web Analytics, and says the app sends no telemetry and keeps work on the user's Mac. Update it in the same change if any of that stops being true, for example if you add custom analytics events or telemetry in the app.

# The website

`apps/web` is dalliance.io: a landing page, a privacy page, a 404, and a route that logs each download and redirects to the latest installer. It uses Next.js 16 with the App Router and Tailwind v4, and has no client data fetching. Its palette, theme and shared class strings come from `@dalliance/brand`, which the cloud site uses too. See [Design](#design).

```bash
pnpm --filter @dalliance/web dev     # http://localhost:3100
pnpm --filter @dalliance/web build
pnpm --filter @dalliance/web start   # serve the build on 3100
```

## Layout

```
src/app/
  page.tsx               the home page: masthead with the live demo, reel, bands
  privacy/page.tsx       the privacy page
  download/route.ts      logs the download, then redirects to the installer
  not-found.tsx          404
  layout.tsx             fonts, metadata, viewport colours
  globals.css            imports @dalliance/brand/theme.css, plus the live demo's palette and animations
public/
  install.sh             the Terminal installer, served at /install.sh. See releasing.md
  sitemap.ts, robots.ts, manifest.ts
  icon.svg, apple-icon.tsx, favicon.ico
  opengraph-image.tsx, twitter-image.tsx   both render socialCard()
src/components/
  Chrome.tsx             SiteHeader, Band, Act (the download button), SiteFooter
  demo/                  the live demo in the hero: Demo.tsx, its charts, its Python highlighting, and data.json
  Reel.tsx               the scrolling screenshot strip with its ledger
  StickyBar.tsx          the top bar that sticks once it reaches the top
  Wordmark.tsx           the mark and the name, from @dalliance/brand
src/lib/
  site.ts                copy, the site URL and the download URL, over brand.ts. Change copy here first
  card.tsx               the 1200 by 630 social card
src/assets/shots/        light and dark captures of the app
scripts/demo-data.py     computes demo/data.json
```

## Configuration

| Variable | Default | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://dalliance.io` | Canonical links, sitemap, robots, social cards |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Unset | The Redis store for the download log. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too |

`NEXT_PUBLIC_SITE_URL` is read at build time. `turbo.json` lists it in the build task's `env`, so changing it busts the cache. The Redis pair is only read when `/download` runs, so it stays out of `turbo.json`. `site.ts` and the route read them with `||` rather than `??`, because Vercel lets a variable be set but empty.

Every download button links to `/download`, with `?from=` naming the button: `bar` for the top bar, `hero` and `end` for the two on the home page, and `demo` for the link the live demo shows when a visitor types a prompt it can't run. Two come from outside the site: `update` from the app's update banner, and `install` from the installer script.

Under each download button, `InstallCommand` shows the Terminal command, `installCommand` in `site.ts`, with a button that copies it. Where the browser won't allow copying, the button selects the command instead. The command runs `public/install.sh`, see [releasing.md](releasing.md#the-terminal-installer). `download/route.ts` answers it with a temporary redirect to `downloadUrl` in `site.ts`, `Dalliance.dmg` on the latest release of the public `amirhesham65/dalliance-releases`, so the URL always serves the newest version. See [releasing.md](releasing.md). The redirect is temporary, not permanent, so moving the installer only means changing `downloadUrl`. `robots.ts` disallows `/download`. The config also sets `nosniff`, `DENY` framing, a strict referrer policy and a permissions policy on every route.

## Analytics

`layout.tsx` renders `<Analytics />` from `@vercel/analytics/next`, which counts page views without cookies. It only sends data from a Vercel deployment with Web Analytics turned on in the project's dashboard, never from `next dev` or a local `next start`. There are no custom events.

### Download log

This is a stopgap until downloads are counted somewhere better. `download/route.ts` pushes one JSON entry per download onto the `downloads` list in an Upstash Redis store, added from the Vercel Marketplace. It writes in `after()`, once the redirect has gone out, so a slow or failed write never delays the download. Bots are skipped, and so is everything when the Redis variables are unset, which covers `next dev`.

Each entry holds `t` (ISO time), `from`, `country`, `region`, `city`, `referrer`, `browser`, `os` and `device`. `referrer` is the page path when the click came from the site, otherwise only the other site's host. No IP is stored.

The list keeps the newest 10,000 entries, `KEEP` in the route. `LPUSH` and `LTRIM` go in one `MULTI`/`EXEC` transaction, Upstash's `/multi-exec`, so the list never grows past the cap, even between the two commands. The privacy page states the cap, so change both together.

The website has no test runner, so the route has no test. The transaction was checked by pointing the Upstash client at a local server: it sends `[["lpush","downloads",...],["ltrim","downloads",0,9999]]` to `/multi-exec`.

The Redis store is `dalliance-downloads`, on Upstash's free plan. To read the log, use the Data Browser in the Upstash console, or pull the variables with the Vercel CLI and call the REST API with the read-only token:

```bash
vercel link --yes --project dalliance
vercel env pull .env.local --yes
(set -a; . ./.env.local; set +a; curl -s -H "Authorization: Bearer $KV_REST_API_READ_ONLY_TOKEN" "$KV_REST_API_URL/lrange/downloads/0/-1")
```

`.env.local` holds the store's tokens, so it must stay out of git.

The log only sees clicks that go through the site. Anyone with the releases repo's link can download the installer without it.

## Design

The site shares its palette and type with the app, so the page and the screenshots match. Both websites, dalliance.io and the cloud site in `apps/cloud`, take their brand from `packages/brand`, `@dalliance/brand`:

| File | Holds |
| --- | --- |
| `theme.css` | The palette, the Tailwind `@theme`, base styles and hatching. Each site's `globals.css` imports it first |
| `ui.ts` | Class strings for the shared grammar: `sheet`, `gutter`, `label`, the buttons, `headline`, `wordmark` and the rest |
| `brand.ts` | The name, the author, the website's URL and the paper colours for the browser chrome |
| `mark.ts`, `Mark.tsx` | The mark's squares, and the component that draws it |

The package has no build step. Both Next apps list it in `transpilePackages`, and `theme.css` has `@source "."` so Tailwind scans `ui.ts` for classes. A change there changes both sites, so check the cloud site's sign-in page too.

`theme.css` copies the app's light and dark colours from `apps/desktop/src/index.css` into its own tokens: `--paper`, `--ink`, `--hairline`, `--brand` and the rest. Utilities read them through `@theme`, so they flip with the system theme without `dark:` on every class. When you change an app colour that the sites show, change it in both files.

Every page follows one grammar: a ruled sheet of warm paper, hairline bands, and short uppercase labels in a 200 px left margin. `Band` in `Chrome.tsx` draws one section. Keep band labels to one line. Shared class groups are in `@dalliance/brand/ui`, so a change to the gutter or the button happens once.

The masthead centres the headline over a live demo: a working miniature of the app, `Demo` in `src/components/demo/`. It draws the app's window, sidebar and notebook in the app's own palette, light and dark, which `globals.css` copies from `apps/desktop/src/index.css` under `.demo`, so change both together. It opens on a finished survival cell, rendered on the server, so the page shows the product before any script runs. A visitor can:

- Click an underlined guess and pick another reading: survival measured from randomisation or first dose, in all patients, those over 65 or stage III, compared with a log-rank or Wilcoxon test. The cell reruns with its steps, and the answer, chart and code change. The popover says that in the app you type any correction.
- Switch a cell to its Code tab.
- Run a suggested next prompt: an adjusted hazard ratio, or early stops by reason, where the agent first asks whether to count the patients who switched arms by intention to treat or per protocol, and the answer changes with the reply.
- Type a prompt in the empty cell at the end. The demo runs its three prompts when the words match one; anything else gets a line saying the demo only runs those, with a download link, `?from=demo`.

Nothing calls a model. Runs are scripted, and every number comes from `src/components/demo/data.json`, which `scripts/demo-data.py` computes with pandas and lifelines from the same generated trial as the desktop app's `?demo&hero` notebook, plus dose dates, early stops and arm switches from its own seed. Change the data there and rerun it: its docstring says how. Charts are SVG drawn in the kernel's dark matplotlib style, so they match the app's output, and they switch to a narrower drawing under 520 px so their text stays readable on a phone. The window has a fixed height, and its notebook only scrolls once the visitor clicks or tabs into it, so a wheel passing over the hero scrolls the page. A mouse leaving the window, a click or tap outside it, or Escape hands the wheel back; on touch screens leaving doesn't count, since a finger lifting fires it. A wheel over the window before that shows a short "Click to scroll the notebook" note, and the window gets a ring while it scrolls. A new cell still scrolls into view in the notebook either way. With reduced motion, steps still play but quickly, and nothing animates. There are no analytics events, as the privacy page says.

## Screenshots

`src/assets/shots/` holds seven scenes, each as `<scene>-light.png` and `<scene>-dark.png`, at 3200 by 2000. `hero` is the screenshot in the page's structured data. The reel on the home page and the repo README use the other six.

To recapture:

1. Build the renderer and serve it with `vite preview`. See [development.md](development.md#looking-at-the-ui-without-electron).
2. Open `/?demo` in a 1600 by 1000 window at 2x, once in light mode and once in dark. For `hero`, open `/?demo&hero` instead.
3. Capture each scene:

| Scene | What's on screen |
| --- | --- |
| `hero` | `Survival analysis.ipynb` in `REGIMEN-2 Trial`, opened on the Kaplan-Meier cell with its chart |
| `answer` | The "Median survival and 2-year survival by arm" cell |
| `ask` | The last cell after pressing Run, with the agent asking how to count patients who switched arms |
| `guess` | An underlined assumption being corrected |
| `code` | That cell's Code tab |
| `history` | The History pane, Cmd+3 |
| `models` | The model picker open |

The demo notebooks live in `apps/desktop/src/dev/demo.ts`: `sampleNotebook()` for the reel, `heroNotebook()` for the hero. Change them there if a scene needs different data. The hero's numbers, tables and chart came from running its cells on the real kernel against a generated `patients.csv`. The chart is saved as `src/dev/hero-chart.png`, so if you change that cell's code, rerun it and replace the file, and the cell's `width` and `height` with the ones the kernel sent.

## Privacy page

The privacy page lists what the site counts through Vercel Web Analytics and what the download log records, what the app keeps on the user's Mac, and what goes with a model request, and says the app sends no telemetry. Update it in the same change if any of that stops being true, for example if you add a field to the download log, custom analytics events, or telemetry in the app. Model requests go through Dalliance Cloud with zero data retention, see [cloud.md](cloud.md#zero-data-retention).

The site doesn't link to the source or call the app open source: the repo is private.

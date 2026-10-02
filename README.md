<div align="center">

<img src="apps/desktop/build/icon.png" width="112" alt="Dalliance icon">

# Dalliance

**The coding agent for researchers.**

A notebook where you write each cell in plain language.<br>
Dalliance writes the Python, runs it on a live kernel and keeps the code that works.

[Download for Mac](https://dalliance.io/download) · [Website](https://dalliance.io) · [Docs](docs/README.md)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/src/assets/shots/answer-dark.png">
  <img src="apps/web/src/assets/shots/answer-light.png" alt="A Dalliance notebook answering 'Median survival and 2-year survival by arm' with a sentence and a summary table">
</picture>

</div>

This is the private repo for Dalliance: the desktop app, the website, and Dalliance Cloud, the service that runs its models.

## What it is

General coding agents are built to ship software. Research needs answers you can defend and notebooks a colleague can rerun. Dalliance is a notebook where you start from the question, and every answer comes with the code that made it.

- **It shows how it read your question.** The agent underlines its assumptions, and correcting one regenerates the cell. When a wrong reading would make the answer useless, it asks. `AGENTS.md` in the notebook's folder is a brief it reads before every cell.
- **Answers come from code that ran.** The agent runs the code, reads the traceback and fixes it. A cell only finishes once its code succeeds, and the Python is one tab away.
- **Reproducible by default.** Verify reruns every cell from a clean start. Each save pins the Python version, the package versions and a hash of every file the cells read. Every cell keeps the record of how it was made, and the last 12 versions. An unchanged prompt reruns its saved code with no model call.
- **It's plain `.ipynb`.** Jupyter, GitHub and reviewers open it as it is.
- **Python runs on your Mac.** The agent reads only the notebook's folder, never `.env` files, and by default asks before code runs shell commands or uses the network.
- **Models run on a Dalliance plan.** Sign in with a Dalliance account, and every model call goes through Dalliance Cloud with zero data retention, paid in credits. Claude Sonnet 5.5 by default.

## The repo

| Path | Package | What it is |
| --- | --- | --- |
| `apps/desktop` | `@dalliance/desktop` | The Electron app: React renderer, Python kernel, the agent harness |
| `apps/web` | `@dalliance/web` | dalliance.io, Next.js |
| `apps/cloud` | `@dalliance/cloud` | cloud.dalliance.io, Next.js: sign-in and billing pages, the auth proxy, and the model proxy with zero data retention |
| `packages/backend` | `@dalliance/backend` | The Convex backend: Better Auth accounts, Polar billing, the usage ledger |
| `packages/shared` | `@dalliance/shared` | The notebook model, `.ipynb` conversion, the IPC contract, and the contract between the app, the cloud site and the backend |
| `packages/brand` | `@dalliance/brand` | The web brand both sites share: the mark, the palette and theme, shared class strings |

## Getting started

You need Node 24, pnpm 10 and Python 3.9 or newer. `corepack enable` picks the pnpm version the root `package.json` pins.

```bash
pnpm install
pnpm dev
```

That runs the desktop app with hot reload. It signs in to `https://cloud.dalliance.io`, so running a prompt needs a Dalliance account with a plan. The website, the cloud site and the backend start on their own: `pnpm --filter @dalliance/web dev` on `:3100`, `pnpm --filter @dalliance/cloud dev` on `:3200`, and `npx convex dev` in `packages/backend`.

To run the cloud site and the backend yourself, see [docs/deploying.md](docs/deploying.md) and [docs/accounts.md](docs/accounts.md#running-it-locally). `DALLIANCE_CLOUD_URL` in `apps/desktop/.env` points a development build at them.

## Checks

```bash
pnpm turbo run lint typecheck test build
```

CI runs the same on every pull request, on Ubuntu and macOS. [docs/development.md](docs/development.md) covers the commands, and [docs/testing.md](docs/testing.md) the tests.

## Docs

[docs/README.md](docs/README.md) is the place to start. It lists the rules that break things when ignored, and links a doc per area.

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE).

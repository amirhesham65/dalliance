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

Dalliance is an open-source desktop notebook for working with data in plain language. This repo contains the app and dalliance.io.

## What it is

General coding agents are built to ship software. Research needs answers you can defend and notebooks a colleague can rerun. Dalliance is a notebook where you start from the question, and every answer comes with the code that made it.

- **It shows how it read your question.** The agent underlines its assumptions, and correcting one regenerates the cell. When a wrong reading would make the answer useless, it asks. `AGENTS.md` in the notebook's folder is a brief it reads before every cell.
- **Answers come from code that ran.** The agent runs the code, reads the traceback and fixes it. A cell only finishes once its code succeeds, and the Python is one tab away.
- **Reproducible by default.** Verify reruns every cell from a clean start. Each save pins the Python version, the package versions and a hash of every file the cells read. Every cell keeps the record of how it was made, and the last 12 versions. An unchanged prompt reruns its saved code with no model call.
- **It's plain `.ipynb`.** Jupyter, GitHub and reviewers open it as it is.
- **Turn notebook data into an app.** Ask a cell to create a Streamlit app, then open it from Apps in the sidebar. Apps live in the project's `apps/` folder, use saved data snapshots and follow Dalliance's light and dark appearance. See [project apps](docs/apps.md).
- **Python runs on your Mac.** The agent reads only the notebook's folder, never `.env` files, and by default asks before code runs shell commands or uses the network.
- **Bring your own API key.** Connect Anthropic, Google, or OpenAI in Settings > Models. Requests go directly to your selected provider, under your own billing and data policies. Keys are encrypted on your device.

## The repo

| Path | Package | What it is |
| --- | --- | --- |
| `apps/desktop` | `@dalliance/desktop` | The Electron app: React renderer, Python kernel, the agent harness |
| `apps/web` | `@dalliance/web` | dalliance.io, Next.js |
| `packages/shared` | `@dalliance/shared` | The notebook model, `.ipynb` conversion, IPC, and provider model catalog |
| `packages/brand` | `@dalliance/brand` | The website brand: the mark, the palette and theme, shared class strings |

## Getting started

You need Node 24, pnpm 10 and Python 3.9 or newer for notebook cells. Apps need an installed Python 3.11 or newer for Streamlit. Dalliance chooses a compatible Python for each app's separate environment, so notebook Python can stay on an older version. `corepack enable` picks the pnpm version the root `package.json` pins.

```bash
pnpm install
pnpm dev
```

That runs the desktop app with hot reload. Add your Anthropic, Google, or OpenAI API key in Settings > Models, choose a model, and set up Python from the app. No hosted backend is needed. Opening notebooks and running saved Python need no API key.

Run the website separately with `pnpm --filter @dalliance/web dev` on port 3100. See [docs/providers.md](docs/providers.md) for model routing, key storage, and optional live tests.

## Checks

```bash
pnpm turbo run lint typecheck test build
```

CI runs the same on every pull request, on Ubuntu and macOS. [docs/development.md](docs/development.md) covers the commands, and [docs/testing.md](docs/testing.md) the tests.

## Docs

[docs/README.md](docs/README.md) is the place to start. It lists the rules that break things when ignored, and links a doc per area.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

# Working on Dalliance

## Docs

- Read [docs/README.md](docs/README.md) before changing code. It lists the rules that break things when ignored and links a doc per area.
- When a change makes a doc wrong, fix the doc in the same change.

## Secrets

- Never print, log, commit or paste secrets: `.env.local` files, `npx convex env` values, keys and webhook secrets. Refer to them by name.

## Authorship

- Never credit Claude, or any other AI assistant, as an author, co-author or contributor. That covers commit messages (no `Co-Authored-By` trailers), pull request titles and descriptions, code comments, docs and changelogs.
- Commits and pull requests are authored by the repository owner alone.

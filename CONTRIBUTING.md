# Contributing

Thanks for helping. This repository is the open-source core of Dalliance: the desktop notebook, the agent, the kernel and the file format, running on the user's own model key.

## What belongs here

Anything that works on one computer with the user's own key: the notebook, cells, the agent and its tools, the Python kernel, `.ipynb` support, settings, the website.

Hosted features are a separate product and don't belong here: accounts, collaboration, credits, billing and the hosted agent. The core must never depend on them. If an idea needs a server, open an issue first so we can agree where it goes.

## License

The code is licensed under the [Apache License 2.0](LICENSE). Your contribution is licensed under it too, as section 5 of the license says. You keep the copyright to your work.

The name, logo and icon are not covered by the license. See [TRADEMARKS.md](TRADEMARKS.md).

## Sign off your commits

Every commit in a pull request needs a `Signed-off-by` line with your name and email. It certifies the [Developer Certificate of Origin](https://developercertificate.org): that you wrote the change, or otherwise have the right to submit it under the project's license.

`git commit -s` adds the line for you:

```
Signed-off-by: Your Name <you@example.com>
```

To sign off commits you already made on your branch, run `git rebase --signoff main` and push again.

## Before you open a pull request

1. Read [docs/README.md](docs/README.md). It lists the rules that break things when ignored, and links a doc for each area.
2. Keep the change to one thing. Two features are two pull requests.
3. Update the docs in the same change when it makes a doc wrong.
4. Run the checks CI runs:

   ```bash
   pnpm turbo run lint typecheck test build
   ```

5. Write the commit like the rest of the history: an imperative subject line, and a body that says what changed and why, wrapped at about 72 characters. See [docs/development.md](docs/development.md#commits-and-pull-requests).

Pull requests merge into `main` with a merge commit.

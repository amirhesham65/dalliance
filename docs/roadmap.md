# Roadmap

What Dalliance Cloud sells, and in what order to build it. Nothing here is committed to users yet, and prices are drafts.

## The line between what's included and what costs more

Models always run through Dalliance Cloud, so every user needs an account, and model use is paid in credits. Past that, charge for what needs a server or costs us money per use. Everything that runs on the user's own machine is never charged for on its own, so every paid feature has an obvious reason to cost money.

Never charged for on its own:

- The notebook, the agent, local Python, Verify and the pins
- Exporting to HTML, PDF and `.ipynb`
- Local data connectors. Only the stored credentials that scheduled runs need live on the service

Whether there's a free tier, and what it includes, is an open decision. See [Open decisions](#open-decisions).

## What to build, in order

| # | Feature | What it is | Needs |
| --- | --- | --- | --- |
| 1 | Hosted models | Every model through one account, paid for in credits, with zero data retention. Built, see [billing.md](billing.md) | |
| 2 | Share links | Publish a notebook as a read-only page on `cloud.dalliance.io`: prompts, code, charts and answers. Viewing is free, publishing is Pro | Convex storage, one page |
| 3 | Sync and history | Notebooks back up on their own, follow you across machines, and any earlier version can be restored | Convex storage, a sync client in the app |
| 4 | Scheduled runs | Rerun a notebook on a schedule and send the results by email or Slack | Cloud kernels, stored data source credentials |
| 5 | Cloud kernels | Python on our servers: bigger machines, GPUs, jobs that keep going when the laptop sleeps. Billed in credits | A sandboxed runtime per user |
| 6 | Background agent | "Analyze this and write it up" runs remotely while the app is closed, and leaves a finished notebook | Cloud kernels, hosted models |
| 7 | Teams | Shared workspaces, a shared brief per team, pooled credits, one invoice, SSO later | Organizations in Better Auth, team plans in Polar |
| 8 | Live collaboration | Two people in one notebook, with cursors and comments | Sync, plus merging edits to cells and outputs |

Why this order:

- **Share links come first** because they're cheap and they grow the product. Every shared analysis carries an "Open in Dalliance" button.
- **Sync keeps people subscribed.** People pay for not losing work, and it's the base collaboration builds on.
- **Scheduled runs are where Pro stops being only model credits** and becomes something the local app can't do.
- **Cloud kernels cost the most to run**, so they come once the credit system has proven itself on models.
- **Teams bring the most revenue**, but only once individuals are already hooked.
- **Live collaboration is last** because merging concurrent edits to cells and outputs is the hard part, not the sync itself.

## Plans

| Plan | Price | Includes |
| --- | --- | --- |
| Free | $0, if there is one | Undecided. See [Open decisions](#open-decisions) |
| Pro | about $20 a month | Hosted models with monthly credits, share links, sync and history, a few scheduled runs |
| Team | per seat | Pro, plus shared workspaces, pooled credits, admin, and SSO later |
| Credit packs | one-off | More models, cloud kernel time and background agent runs |

Anything that costs us per use, like models, kernels and agent runs, is paid in credits, so one credit system covers every metered feature. See [billing.md](billing.md#models) for how credits map to cost.

## Open decisions

- **The credit rate.** 100 credits a dollar makes a credit a cent of model cost. 1,000 gives rounder numbers for small calls.
- **The Pro allowance.** Measured model costs are about $0.29 a cell on Opus 5.5, $0.13 on Sonnet 5 and $0.05 on Gemini Flash. At $20 a month, the allowance and the default model decide the margin.
- **A free tier.** The app can't run a prompt without a plan, so a free tier would have to include some credits. Whether to offer one, how many credits, and which models, is undecided.
- **A free trial**, and whether it's credits or days.
- **Reselling the gateway.** Check Vercel's AI Gateway terms allow metered resale through one key before launch.

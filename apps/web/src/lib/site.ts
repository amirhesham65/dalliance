import { brand } from '@dalliance/brand/brand'

/** Everything the pages, metadata and social cards say about the site, in one place. */
export const site = {
  ...brand,
  // `||`, not `??`: a variable set but left blank, as Vercel allows, counts as unset
  url: (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://dalliance.io').replace(/\/$/, ''),
  title: 'Dalliance · The Coding Agent for Researchers',
  headline: 'The Coding Agent for Researchers',
  tagline: 'Like a Jupyter notebook, but you write each cell in plain language. Dalliance writes the Python, runs it and keeps the code that works.',
  description:
    'Dalliance is a coding agent for researchers. It works like a Jupyter notebook, but you write each cell in plain language and it writes, runs and checks the Python.',
  keywords: [
    'coding agent for researchers',
    'research notebook',
    'AI notebook',
    'plain language notebook',
    'Jupyter alternative',
    'natural language to Python',
    'AI data analysis',
    'Python notebook agent',
    'ipynb',
    'pandas',
    'Mac notebook app',
    'macOS data analysis',
  ],
  status: 'Early preview',
  // The latest release in the public releases repo, which the release workflow publishes to. See docs/releasing.md
  downloadUrl: 'https://github.com/amirhesham65/dalliance-releases/releases/latest/download/Dalliance.dmg',
} as const

/** Installs the latest release from Terminal with public/install.sh. See docs/releasing.md */
export const installCommand = `curl -fsSL ${site.url}/install.sh | sh`

/** Everything the pages, metadata and social cards say about the site, in one place. */
export const site = {
  name: 'Dalliance',
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dalliance.app').replace(/\/$/, ''),
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
  author: 'Amir Hesham',
  status: 'Early preview',
  downloadUrl: process.env.DALLIANCE_DOWNLOAD_URL ?? 'https://github.com/amirhesham65/ilios/releases/latest',
  // Light and dark page colours, for the browser chrome and the manifest
  paper: { light: '#f7f6f3', dark: '#141413' },
} as const

/** Everything the pages, metadata and social cards say about the site, in one place. */
export const site = {
  name: 'Dalliance',
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
  author: 'Amir Hesham',
  status: 'Early preview',
  // The release workflow overwrites this file in the Vercel Blob store on every release. See docs/releasing.md
  downloadUrl: 'https://qxsto1algu0y5wp9.public.blob.vercel-storage.com/Dalliance.dmg',
  // Light and dark page colours, for the browser chrome and the manifest
  paper: { light: '#f7f6f3', dark: '#141413' },
} as const

export type ChartThemeName = 'light' | 'dark'

/** Colours shared by the renderer's charts and the Python kernel. */
export const CHART_THEMES = {
  light: {
    background: '#ffffff',
    foreground: '#1d1d1b',
    muted: '#6b6a65',
    edge: '#c9c8c2',
    grid: '#e7e6e2',
    colors: ['#2b8a8a', '#d0561b', '#5b5bd6', '#2f9e44', '#b7791f', '#7b3aa8'],
  },
  dark: {
    background: '#1a1a19',
    foreground: '#ecebe7',
    muted: '#a3a29c',
    edge: '#55554f',
    grid: '#2b2b29',
    colors: ['#5fb3b3', '#e8793b', '#8e8eea', '#4cc764', '#e9b04a', '#d7a2f0'],
  },
} satisfies Record<ChartThemeName, { background: string; foreground: string; muted: string; edge: string; grid: string; colors: string[] }>

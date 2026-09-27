import { type Notebook, newNoteCell, newPromptCell } from '@dalliance/shared/notebook'

/** One-line prompts that need no data files, for trying the app on the start page. */
export const STARTERS: { prompt: string; hint: string }[] = [
  { prompt: 'Roll two dice 10,000 times and plot how often each total comes up', hint: 'A chart from nothing' },
  { prompt: 'Make a table of 500 made-up orders from this year with a region, a plan and a total', hint: 'Data to play with' },
  { prompt: 'How much is $10,000 worth after 30 years at 7% a year, compounded monthly?', hint: 'A quick answer' },
]

/** A short notebook that makes its own data, so the first Run all works in any folder. */
export function sampleNotebook(): Notebook {
  return {
    cells: [
      newNoteCell(
        '# A first notebook\nEach cell below is a prompt. Press Run all: the agent writes the Python for each one, runs it, and checks the result. Open the Code tab under any cell to read what it wrote.',
      ),
      newPromptCell('Make a table of 500 made-up orders from the last six months with a region, a plan (starter, pro or team) and a total'),
      newPromptCell('Revenue by month and plan, as a stacked bar chart'),
      newPromptCell('Which region grew fastest from the first month to the last?'),
    ],
  }
}

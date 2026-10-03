import raw from './data.json'

// The numbers behind the live demo. scripts/demo-data.py computes every one of them from the generated trial the
// desktop app's ?demo&hero notebook uses, so the demo never shows a number the code wouldn't give.

export type Origin = 'randomisation' | 'first dose'
export type Population = 'all patients' | 'patients over 65' | 'stage III patients'
export type Test = 'log-rank test' | 'Wilcoxon test'
export type Counting = 'intention to treat' | 'per protocol'

export interface Arm {
  label: string
  n: number
  median: number | null
  steps: [number, number][]
  censored: [number, number][]
}

export interface Survival {
  n: number
  arms: Arm[]
  p: Record<Test, number>
}

export interface Stopped {
  patients: number
  stopped: number
  reasons: string[]
  counts: Record<string, number[]>
}

export const data = raw as unknown as {
  patients: number
  switched: number
  survival: Record<Origin, Record<Population, Survival>>
  hazards: { index: string[]; columns: string[]; rows: number[][] }
  stopped: Record<Counting, Stopped>
}

export const ORIGINS: Origin[] = ['randomisation', 'first dose']
export const POPULATIONS: Population[] = ['all patients', 'patients over 65', 'stage III patients']
export const TESTS: Test[] = ['log-rank test', 'Wilcoxon test']

/** "p = .004", "p = .61", "p < .001", the way the answers print them. */
export function formatP(p: number): string {
  if (p < 0.001) return 'p < .001'
  return `p = ${(p < 0.01 ? p.toFixed(3) : p.toFixed(2)).replace(/^0/, '')}`
}

/** A population as the interpretation reads, with its count when it's everyone. */
export const populationText = (population: Population) => (population === 'all patients' ? `all ${data.patients} patients` : population)

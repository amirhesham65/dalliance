export interface GenerationRun {
  finished: Promise<HTMLElement>
  cancel(): void
  element: HTMLElement
}
export function generate(element: HTMLElement, options?: { mode?: 'skeleton'; maxParts?: number; keys?: number }): GenerationRun

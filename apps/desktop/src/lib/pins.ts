import type { PinChange } from '@dalliance/shared/ipc'

/** One change since the notebook was saved, in words: "pandas 2.1.0, now 2.2.3". */
export function describePinChange(change: PinChange): string {
  switch (change.kind) {
    case 'python':
      return `Python ${change.was}, now ${change.now}`
    case 'package':
      return change.now == null ? `${change.name} ${change.was}, not installed now` : `${change.name} ${change.was}, now ${change.now}`
    case 'file':
      return change.change === 'missing' ? `${change.path} is missing` : `${change.path} has changed`
  }
}

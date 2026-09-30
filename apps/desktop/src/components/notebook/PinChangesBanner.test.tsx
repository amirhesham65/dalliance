import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PinChange } from '@dalliance/shared/ipc'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useNotebook } from '@/store/notebook-store'
import { PinChangesBanner } from './PinChangesBanner'

const CHANGES: PinChange[] = [
  { kind: 'python', was: '3.11.9', now: '3.12.4' },
  { kind: 'package', name: 'pandas', was: '2.1.0', now: '2.2.3' },
  { kind: 'package', name: 'scipy', was: '1.13.0', now: null },
  { kind: 'file', path: 'data/visits.csv', change: 'contents' },
  { kind: 'file', path: 'data/labs.csv', change: 'missing' },
]

const show = (changes: PinChange[]) => act(() => useNotebook.setState({ pinChanges: changes }))
const banner = () => screen.queryByRole('status', { name: 'Changed since this notebook was saved' })

function renderBanner() {
  return render(
    <TooltipProvider>
      <PinChangesBanner />
    </TooltipProvider>,
  )
}

beforeEach(() => useNotebook.setState({ pinChanges: [] }))

describe('PinChangesBanner', () => {
  it('shows nothing when nothing changed', () => {
    renderBanner()
    expect(banner()).not.toBeInTheDocument()
  })

  it('lists the first changes in words and offers the rest', async () => {
    renderBanner()
    show(CHANGES)
    expect(banner()).toHaveTextContent(
      'Changed since this notebook was saved: Python 3.11.9, now 3.12.4; pandas 2.1.0, now 2.2.3; scipy 1.13.0, not installed now; and 2 more.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'and 2 more' }))
    expect(banner()).toHaveTextContent('data/visits.csv has changed; data/labs.csv is missing.')
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
  })

  it('folds again for a new check', async () => {
    renderBanner()
    show(CHANGES)
    await userEvent.click(screen.getByRole('button', { name: 'and 2 more' }))
    show([...CHANGES])
    expect(screen.getByRole('button', { name: 'and 2 more' })).toBeInTheDocument()
  })

  it('goes away when dismissed', async () => {
    renderBanner()
    show(CHANGES.slice(3))
    expect(banner()).toHaveTextContent('Changed since this notebook was saved: data/visits.csv has changed; data/labs.csv is missing.')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss what changed' }))
    expect(banner()).not.toBeInTheDocument()
    expect(useNotebook.getState().pinChanges).toEqual([])
  })
})

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '@dalliance/shared/ipc'
import { setApi } from '@/store/notebook-store'
import { fakeApi, result } from '@/test/fake-api'
import { FileTree } from './FileTree'

describe('large file trees', () => {
  it('delays the folder spinner so fast reads do not flash controls', async () => {
    const { api } = fakeApi(() => result())
    let release!: (entries: FileEntry[]) => void
    api.listFiles = () => new Promise<FileEntry[]>((resolve) => { release = resolve })
    setApi(api)
    render(<FileTree files={[{ path: 'data', kind: 'directory', size: '' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'data' }))
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    expect(await screen.findByText('Loading…')).toBeInTheDocument()
    await act(async () => release([]))
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('mounts only visible rows while scrolling and keyboard navigation can reach the last file', async () => {
    const user = userEvent.setup()
    const files: FileEntry[] = Array.from({ length: 5000 }, (_, index) => ({ path: `file-${String(index).padStart(5, '0')}.csv`, size: '1 B', kind: 'file' }))
    const { api } = fakeApi(() => result())
    api.revealFile = vi.fn().mockResolvedValue(undefined)
    setApi(api)
    render(<FileTree files={files} />)
    const tree = screen.getByRole('tree', { name: 'Workspace files' })
    expect(within(tree).getAllByRole('treeitem').length).toBeLessThan(40)
    expect(within(tree).queryByRole('button', { name: 'file-04999.csv' })).not.toBeInTheDocument()
    fireEvent.scroll(tree.parentElement!, { target: { scrollTop: 4990 * 32 } })
    expect(within(tree).getByRole('button', { name: 'file-04999.csv' })).toBeInTheDocument()
    tree.focus()
    await user.keyboard('{End}{Enter}')
    expect(api.revealFile).toHaveBeenLastCalledWith('file-04999.csv')
    expect(document.getElementById(tree.getAttribute('aria-activedescendant')!)).toHaveAttribute('aria-label', 'file-04999.csv')
    await user.keyboard('{Home}{Enter}')
    expect(api.revealFile).toHaveBeenLastCalledWith('file-00000.csv')
    expect(within(tree).getAllByRole('treeitem').length).toBeLessThan(40)
  })

  it('shows failed and empty folders, and lets a failed folder retry', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    api.listFiles = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce([])
    setApi(api)
    render(<FileTree files={[{ path: 'data', kind: 'directory', size: '' }]} />)
    const folder = screen.getByRole('button', { name: 'data' })
    expect(api.listFiles).not.toHaveBeenCalled()
    await user.click(folder)
    expect(await screen.findByText("Couldn't read folder. Click to retry.")).toBeInTheDocument()
    await user.click(folder)
    expect(await screen.findByText('Empty')).toBeInTheDocument()
    expect(api.listFiles).toHaveBeenCalledTimes(2)
  })

  it('drops a folder reply overtaken by a refresh', async () => {
    const user = userEvent.setup()
    const { api } = fakeApi(() => result())
    let release!: (entries: FileEntry[]) => void
    api.listFiles = vi.fn()
      .mockImplementationOnce(() => new Promise<FileEntry[]>((resolve) => { release = resolve }))
      .mockResolvedValueOnce([{ path: 'data/new.csv', kind: 'file', size: '2 B' }])
    setApi(api)
    const files: FileEntry[] = [{ path: 'data', kind: 'directory', size: '' }]
    const view = render(<FileTree files={files} />)
    await user.click(screen.getByRole('button', { name: 'data' }))
    await waitFor(() => expect(api.listFiles).toHaveBeenCalledTimes(1))
    view.rerender(<FileTree files={[...files]} />)
    expect(await screen.findByRole('button', { name: 'new.csv' })).toBeInTheDocument()
    await act(async () => release([{ path: 'data/old.csv', kind: 'file', size: '1 B' }]))
    expect(screen.queryByRole('button', { name: 'old.csv' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'new.csv' })).toBeInTheDocument()
  })
})

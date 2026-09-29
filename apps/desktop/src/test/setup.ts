import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, vi } from 'vitest'

// jsdom doesn't implement layout, so scrolling is a no-op in tests
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
// Radix's Select asks for pointer capture, which jsdom doesn't have
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
}

afterEach(() => cleanup())

// Resizable panels measure with ResizeObserver, and the sidebar checks the viewport with matchMedia
if (typeof window !== 'undefined') {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

// jsdom measures every element as 0×0, so the panels' pointer handling treats each click as a press on a
// resize handle and keeps focus from moving. Tests cover the app, not the layout library: plain containers.
vi.mock('react-resizable-panels', () => {
  const box = ({ children, className }: { children?: ReactNode; className?: string }) => createElement('div', { className }, children)
  return { Group: box, Panel: box, Separator: () => null, useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: () => {} }) }
})

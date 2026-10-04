import { type DragEvent, useRef, useState } from 'react'
import { actions } from '@/store/notebook-store'

const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

/**
 * Lets files from the computer be dropped on a prompt cell, which attaches them. `dropping` is true while files are
 * dragged over it. A drag of text or of anything else is left to the browser.
 */
export function useFileDrop(cellId: string) {
  const [dropping, setDropping] = useState(false)
  // Entering a child fires dragenter there before dragleave here, so count rather than toggle
  const depth = useRef(0)

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth.current++
      setDropping(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      // Without this the drop goes to the textarea, or the window tries to open the file
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDropping(false)
    },
    onDrop: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDropping(false)
      actions.select(cellId)
      void actions.attachFiles(cellId, [...e.dataTransfer.files])
    },
  }
  return { dropping, handlers }
}

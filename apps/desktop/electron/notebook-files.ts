import { existsSync } from 'node:fs'
import path from 'node:path'

/** A name for a new notebook in `dir` that nothing has: "Untitled.ipynb", then "Untitled 2.ipynb", "Untitled 3.ipynb". */
export function newNotebookPath(dir: string, name = 'Untitled'): string {
  let file = path.join(dir, `${name}.ipynb`)
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `${name} ${n}.ipynb`)
  return file
}

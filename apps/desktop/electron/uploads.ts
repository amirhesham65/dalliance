import { constants, existsSync } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AttachResult } from '@dalliance/shared/ipc'

/** The folder inside a project that dropped files are copied into. */
export const UPLOADS = 'uploads'

/** A name in `dir` that nothing has: "data.csv", then "data 2.csv", "data 3.csv". */
export function freeName(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = name
  for (let n = 2; existsSync(path.join(dir, candidate)); n++) candidate = `${stem} ${n}${ext}`
  return candidate
}

/** A path inside `root`, written with forward slashes the way the agent and the Files pane show it. */
const inside = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/')

/**
 * Copy files into `uploads` in the project folder `root`, each under a free name, and return their paths inside it.
 * A file already in the folder is used where it is, not copied again. Folders and missing files are skipped, and
 * named in `error`. Never throws.
 */
export async function copyIntoUploads(root: string, sources: string[]): Promise<AttachResult> {
  const paths: string[] = []
  const failures: string[] = []
  const uploads = path.join(root, UPLOADS)
  for (const source of sources) {
    const name = path.basename(source)
    try {
      if (!path.isAbsolute(source)) throw new Error('not a file on this computer')
      if (!(await stat(source)).isFile()) throw new Error('only files can be attached, not folders')
      const relative = path.relative(root, source)
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        paths.push(inside(root, source))
        continue
      }
      await mkdir(uploads, { recursive: true })
      // COPYFILE_EXCL: a file that appeared under the chosen name since it was picked is never overwritten
      for (let attempt = 0; ; attempt++) {
        const target = path.join(uploads, freeName(uploads, name))
        try {
          await copyFile(source, target, constants.COPYFILE_EXCL)
          paths.push(inside(root, target))
          break
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 4) throw err
        }
      }
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'it has gone' : err instanceof Error ? err.message.split('\n')[0] : String(err)
      failures.push(`Couldn't attach ${name || 'a file'}: ${reason}.`)
    }
  }
  return { paths, error: failures.length ? failures.join(' ') : null }
}

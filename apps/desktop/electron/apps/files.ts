import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export async function safeAppPath(root: string, relative: string): Promise<string> {
  const target = path.resolve(root, relative)
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('App path is outside the project.')
  let cursor = root
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part)
    const info = await lstat(cursor).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err })
    if (info?.isSymbolicLink()) throw new Error('App files cannot be symlinks.')
  }
  return target
}
export async function readAppText(file: string, limit = 250_000) {
  if ((await stat(file)).size > limit) throw new Error('App file is too large.')
  return readFile(file, 'utf8')
}
export async function copyAppFolder(root: string, relative: string, destination: string) {
  let count = 0
  const copy = async (from: string, to: string) => {
    const file = await safeAppPath(root, from)
    const info = await lstat(file)
    if (++count > 5000) throw new Error('The app has more than 5,000 files. Move generated files outside its app folder before updating it.')
    if (info.isDirectory()) {
      await mkdir(to, { recursive: true })
      for (const name of await readdir(file)) await copy(`${from}/${name}`, path.join(to, name))
    } else if (info.isFile()) await copyFile(file, to)
    else throw new Error('App folders can only contain regular files and directories.')
  }
  await copy(relative, destination)
}
export const appHash = (bytes: Uint8Array | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

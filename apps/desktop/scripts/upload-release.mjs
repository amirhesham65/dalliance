// Uploads release/Dalliance.dmg to the dalliance-downloads Vercel Blob store, twice: kept under the version's tag, and
// over Dalliance.dmg, which the website's /download points at. Reads BLOB_READ_WRITE_TOKEN. See docs/releasing.md
import { readFile } from 'node:fs/promises'
import { put } from '@vercel/blob'

const tag = process.argv[2]
if (!tag) throw new Error('Pass the release tag, like v0.3.0')

const dmg = await readFile(new URL('../release/Dalliance.dmg', import.meta.url))
const options = { access: 'public', multipart: true, addRandomSuffix: false, contentType: 'application/x-apple-diskimage' }

const kept = await put(`releases/${tag}/Dalliance.dmg`, dmg, options)
console.log(`Uploaded ${kept.url}`)
// A five-minute cache, so a new release reaches the site within minutes
const latest = await put('Dalliance.dmg', dmg, { ...options, allowOverwrite: true, cacheControlMaxAge: 300 })
console.log(`Uploaded ${latest.url}`)

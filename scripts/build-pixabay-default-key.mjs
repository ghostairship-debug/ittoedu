import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** A distributor supplies this explicit build input; PIXABAY_API_KEY is a development key, never a fallback. */
export async function writePixabayDefaultKey(output, environment = process.env) {
  const directory = path.join(output, 'main', 'workbench', 'assetSources')
  const filename = path.join(directory, 'pixabay-default-key.json')
  const key = environment.GUOLING_PIXABAY_DEFAULT_KEY?.trim()
  if (!key) { await rm(filename, { force: true }); return }
  if (/[\r\n\x00]/.test(key)) throw new Error('Pixabay default build key is invalid')
  await mkdir(directory, { recursive: true })
  await writeFile(filename, JSON.stringify({ key }), { mode: 0o600 })
}

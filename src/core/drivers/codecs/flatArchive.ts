import { Unzip, UnzipInflate, Zip, ZipDeflate } from 'fflate'

function join(chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/** fflate's flat convenience dictionaries use prototype setters. Its file
 * streams retain exact archive names; callers still own path validation.
 */
export function zipFlatArchive(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const chunks: Uint8Array[] = []
  const archive = new Zip((error, bytes) => { if (error) throw error; chunks.push(bytes) })
  for (const [name, bytes] of Object.entries(files)) {
    const file = new ZipDeflate(name)
    archive.add(file); file.push(bytes, true)
  }
  archive.end()
  return join(chunks)
}

export function unzipFlatArchive(bytes: Uint8Array, options: { filter?(file: { name: string }): boolean } = {}): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = Object.create(null)
  const archive = new Unzip(file => {
    if (options.filter && !options.filter(file)) return
    const chunks: Uint8Array[] = []
    file.ondata = (error, chunk, final) => {
      if (error) throw error
      chunks.push(chunk)
      if (final) files[file.name] = join(chunks)
    }
    file.start()
  })
  archive.register(UnzipInflate)
  archive.push(bytes, true)
  return files
}

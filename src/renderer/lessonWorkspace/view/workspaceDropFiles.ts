/** Browser File/entry bytes are explicit drag authorization; OS source paths are never sent to Main. */
export async function snapshotWorkspaceDrop(data: DataTransfer): Promise<{ files: { name: string; bytes: Uint8Array<ArrayBuffer> }[]; directories: string[] }> {
  const files: { name: string; bytes: Uint8Array<ArrayBuffer> }[] = [], directories: string[] = []
  let totalBytes = 0
  const add = async (file: File, name: string) => {
    totalBytes += file.size
    if (files.length >= 32 || totalBytes > 64 * 1024 * 1024) throw new Error('每次最多拖入 32 个文件，总计不超过 64 MiB')
    files.push({ name, bytes: new Uint8Array(await file.arrayBuffer()) })
  }
  const visit = async (entry: FileSystemEntry, prefix = ''): Promise<void> => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isFile) { const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)); await add(file, name) }
    else if (entry.isDirectory) {
      if (directories.length >= 256 || name.split('/').length > 32) throw new Error('拖入目录数量或层级超过限制')
      directories.push(name)
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      while (true) { const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject)); if (!entries.length) break; for (const child of entries) await visit(child, name) }
    } else throw new Error('拖入项不是普通文件或文件夹')
  }
  const entries = [...data.items].filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.())
  if (entries.length && entries.every(Boolean)) for (const entry of entries) await visit(entry!)
  else for (const file of [...data.files]) await add(file, file.name)
  return { files, directories }
}

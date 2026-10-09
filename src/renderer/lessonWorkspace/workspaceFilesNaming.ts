import { nativeProjectFilename } from '../../shared/nativeProjectFile'
import type { WorkspaceListItem } from '../../shared/workbench/workspaceFiles'

export type CreateFileType = 'create-markdown' | 'create-course' | 'create-text' | 'mkdir'

export function computeDefaultName(type: CreateFileType, existingItems: WorkspaceListItem[] = []): string {
  let base = ''
  let ext = ''
  switch (type) {
    case 'create-markdown':
      base = '新建 Markdown 文档'
      ext = '.md'
      break
    case 'create-course':
      base = '新建 果铃工程'
      ext = '.glx'
      break
    case 'create-text':
      base = '新建文本文档'
      ext = '.txt'
      break
    case 'mkdir':
      base = '新建文件夹'
      ext = ''
      break
  }
  return uniqueFilename(base, ext, existingItems)
}

/** `base` + `ext`, numbered "base (2)ext", "base (3)ext"… past the names already in the folder. */
export function uniqueFilename(base: string, ext: string, existingItems: WorkspaceListItem[] = []): string {
  const existingNames = new Set(existingItems.map(item => item.name.toLowerCase()))
  let candidate = ext ? `${base}${ext}` : base
  if (!existingNames.has(candidate.toLowerCase())) {
    return candidate
  }
  let index = 2
  while (true) {
    candidate = ext ? `${base} (${index})${ext}` : `${base} (${index})`
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate
    }
    index++
  }
}

const TYPED_EXTENSION: Partial<Record<CreateFileType, string>> = { 'create-markdown': '.md', 'create-course': '.glx', 'create-text': '.txt' }

export function normalizeNewFilename(type: CreateFileType, raw: string): string {
  let filename = raw.trim()
  // Only the stem is selected in the name box, so typing a whole name repeats the kept extension ("a.md.md").
  const typed = TYPED_EXTENSION[type]
  if (typed) while (filename.toLowerCase().endsWith(typed + typed)) filename = filename.slice(0, -typed.length)
  if (type === 'create-markdown' && !/\.md$/i.test(filename)) {
    filename += '.md'
  }
  if (type === 'create-course') filename = nativeProjectFilename(filename)
  if (type === 'create-text') {
    const dot = filename.lastIndexOf('.')
    if (dot === -1 || dot === filename.length - 1) {
      filename = (dot === -1 ? filename : filename.slice(0, -1)) + '.txt'
    }
  }
  return filename
}

export function getStemSelectionRange(name: string): [number, number] {
  const dot = name.lastIndexOf('.')
  const end = dot > 0 ? dot : name.length
  return [0, end]
}

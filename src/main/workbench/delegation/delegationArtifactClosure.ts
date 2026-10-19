import { promises as fs } from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'
import { readHtmlClosure } from '../htmlImport/readHtmlClosure'
import type { ImportDiagnostic } from '../htmlImport/types'
import { readComponentSourceClosure } from '../projectFiles/componentSourceClosure'
import { decodeHtmlSource } from '../../../shared/html/sourceEncoding'

const SOURCE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'])
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Follow actual supported relative consumers from declared entries, never enumerate the workspace. */
export async function delegationArtifactClosure(copyRoot: string, entries: readonly string[], signal: AbortSignal): Promise<{
  names: readonly string[]; diagnostics: readonly string[]
}> {
  const root = await fs.realpath(copyRoot), names = new Set(entries), pending = [...entries], diagnostics = new Set<string>()
  const add = (filename: string) => {
    if (!inside(root, filename) || filename === root) return
    const name = path.relative(root, filename).split(path.sep).join('/')
    if (!names.has(name)) { names.add(name); pending.push(name) }
  }
  while (pending.length) {
    signal.throwIfAborted()
    const name = pending.shift()!, extension = path.posix.extname(name).toLowerCase()
    if (!SOURCE.has(extension) && !['.html', '.htm', '.css', '.md', '.markdown'].includes(extension)) continue
    try {
      const filename = await fs.realpath(path.resolve(root, name))
      if (!inside(root, filename)) { diagnostics.add(`${name}：成果依赖离开当前候选副本，保留入口及其他可用文件`); continue }
      const bytes = new Uint8Array(await fs.readFile(filename, { signal }))
      const text = extension === '.html' || extension === '.htm' ? decodeHtmlSource(bytes).text
        : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (SOURCE.has(extension)) {
        const closure = await readComponentSourceClosure({ filename, rootDir: root, bytes, text, signal })
        for (const relative of closure.files.keys()) add(path.resolve(root, relative))
        // The source closure owner may add diagnostics without changing its file map contract.
        for (const diagnostic of (closure as typeof closure & { diagnostics?: readonly ImportDiagnostic[] }).diagnostics ?? [])
          diagnostics.add(`${name}：${diagnostic.message}`)
      } else {
        const sourceHtml = extension === '.css' ? `<style>${text.replace(/<\/style/gi, '<\\/style')}</style>`
          : extension === '.md' || extension === '.markdown' ? await marked.parse(text, { async: false }) : text
        const closure = await readHtmlClosure({ htmlPath: filename, rootDir: root, sourceHtml })
        for (const relative of closure.siblingFiles.keys()) add(path.resolve(path.dirname(filename), relative))
        for (const diagnostic of closure.diagnostics)
          diagnostics.add(`${name}：${diagnostic.message}`)
      }
    } catch (error) {
      signal.throwIfAborted()
      diagnostics.add(`${name}：无法完整读取成果依赖（${error instanceof Error ? error.message : String(error)}）；保留原入口及其他可用文件`)
    }
  }
  signal.throwIfAborted()
  return { names: [...names], diagnostics: [...diagnostics] }
}

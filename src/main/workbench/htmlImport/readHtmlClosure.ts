import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { extractHtmlResources } from './extractHtmlResources'
import { validateHtmlImport } from './validateHtmlImport'
import type { ExtractHtmlResourcesResult } from './types'

export interface ReadHtmlClosureInput {
  htmlPath: string
  rootDir?: string
  sourceHtml?: string
  currentSource?(filename: string): Promise<string | undefined>
}

export interface ReadHtmlClosureResult extends ExtractHtmlResourcesResult {
  siblingFiles: ReadonlyMap<string, Uint8Array>
}

function confined(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/** Reads only references found by the extractor; the caller's selected HTML is the default root. */
export async function readHtmlClosure(input: ReadHtmlClosureInput): Promise<ReadHtmlClosureResult> {
  if (!isAbsolute(input.htmlPath)) {
    if (input.sourceHtml === undefined || input.rootDir) throw new Error('未绑定 HTML 只能从当前正文导入自包含资源')
    const siblingFiles = new Map<string, Uint8Array>()
    return { ...extractHtmlResources({ html: input.sourceHtml, siblingFiles }), siblingFiles }
  }
  const htmlFile = await realpath(input.htmlPath)
  const base = dirname(htmlFile)
  const root = await realpath(input.rootDir ?? dirname(htmlFile))
  if (!confined(root, htmlFile)) throw new Error('HTML 文件不在批准的资源根目录内')
  const html = input.sourceHtml ?? await input.currentSource?.(htmlFile) ?? (await readFile(htmlFile)).toString('utf8')
  const files = new Map<string, Uint8Array>()
  const unreadable = new Map<string, string>()
  let result = extractHtmlResources({ html, siblingFiles: files })
  for (;;) {
    const missing = result.diagnostics.filter(diagnostic => diagnostic.code === 'missing-relative-resource' && diagnostic.reference)
    let added = false
    for (const diagnostic of missing) {
      const key = diagnostic.reference!
      if (files.has(key)) continue
      const path = resolve(base, key)
      if (!confined(root, path)) continue
      let target: string
      try { target = await realpath(path) } catch { continue }
      if (!confined(root, target)) continue
      try {
        const current = await input.currentSource?.(target)
        const bytes = current === undefined ? new Uint8Array(await readFile(target)) : new TextEncoder().encode(current)
        files.set(key, bytes)
        added = true
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        unreadable.set(key, error instanceof Error ? error.message : String(error))
      }
    }
    if (!added) break
    result = extractHtmlResources({ html, siblingFiles: files })
  }
  for (const [reference, message] of unreadable) result.diagnostics.push({ level: 'warning', code: 'resource-read', reference, message: `无法读取相对资源 ${reference}：${message}；原引用与其他可用内容已保留` })
  return { ...result, siblingFiles: files }
}

export { validateHtmlImport }

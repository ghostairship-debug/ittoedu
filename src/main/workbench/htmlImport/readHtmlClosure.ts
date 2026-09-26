import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { extractHtmlResources } from './extractHtmlResources'
import { validateHtmlImport } from './validateHtmlImport'
import type { ExtractHtmlResourcesResult } from './types'

export interface ReadHtmlClosureInput {
  htmlPath: string
  rootDir?: string
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
  const htmlFile = await realpath(input.htmlPath)
  const base = dirname(htmlFile)
  const root = await realpath(input.rootDir ?? dirname(htmlFile))
  if (!confined(root, htmlFile)) throw new Error('HTML 文件不在批准的资源根目录内')
  const html = (await readFile(htmlFile)).toString('utf8')
  const files = new Map<string, Uint8Array>()
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
      const bytes = await readFile(target)
      files.set(key, new Uint8Array(bytes))
      added = true
    }
    if (!added) break
    result = extractHtmlResources({ html, siblingFiles: files })
  }
  return { ...result, siblingFiles: files }
}

export { validateHtmlImport }

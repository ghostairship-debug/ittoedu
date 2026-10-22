import { readFile, realpath, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { extractHtmlResources } from './extractHtmlResources'
import { validateHtmlImport } from './validateHtmlImport'
import type { ExtractHtmlResourcesInput, ExtractHtmlResourcesResult } from './types'

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

/** Only a concrete image directory already named by a resource expression is
 * expanded. Each file stays inside the same authorized realpath closure. */
export async function readHtmlMediaDirectory(base: string, root: string, reference: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const requested = resolve(base, reference)
  if (!confined(root, requested)) return new Map()
  const directory = await realpath(requested)
  if (!confined(root, directory)) return new Map()
  const files = new Map<string, Uint8Array>()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|apng)$/i.test(entry.name)) continue
    const filename = await realpath(resolve(directory, entry.name))
    if (confined(root, filename)) files.set(`${reference}/${entry.name}`, new Uint8Array(await readFile(filename)))
  }
  return files
}

/** A missing open source keeps its real binding. Resolve surviving ancestors so
 * a junction cannot turn that fallback into access outside the approved root. */
export async function resolveSourceInputPath(filename: string): Promise<{ filename: string; missing?: unknown }> {
  const requested = resolve(filename)
  const missing = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
  try { return { filename: await realpath(requested) } }
  catch (error) {
    if (!missing(error)) throw error
    let ancestor = dirname(requested)
    for (;;) {
      try { return { filename: resolve(await realpath(ancestor), relative(ancestor, requested)), missing: error } }
      catch (ancestorError) {
        if (!missing(ancestorError)) throw ancestorError
        const parent = dirname(ancestor)
        if (parent === ancestor) throw error
        ancestor = parent
      }
    }
  }
}

/** Resolves one fixed source with its retained bytes before asking its caller for
 * missing files. This is also usable after the source file itself disappeared. */
export async function captureHtmlClosure(input: {
  html: string
  siblingFiles?: ReadonlyMap<string, Uint8Array>
  readRelative?(reference: string): Promise<Uint8Array | undefined>
  readRelativeDirectory?(reference: string): Promise<ReadonlyMap<string, Uint8Array>>
  extractResources?(input: ExtractHtmlResourcesInput): Promise<ExtractHtmlResourcesResult>
}): Promise<ReadHtmlClosureResult> {
  const files = new Map(input.siblingFiles)
  const unreadable = new Map<string, string>()
  const attempted = new Set<string>()
  const closedDirectories = new Set<string>()
  const extract = input.extractResources ?? extractHtmlResources
  let result = await extract({ html: input.html, siblingFiles: files, closedDirectories })
  for (;;) {
    const missing = result.diagnostics.filter(diagnostic => diagnostic.code === 'missing-relative-resource' && diagnostic.reference)
    let added = false
    for (const diagnostic of result.diagnostics) if (diagnostic.code === 'missing-relative-directory' && diagnostic.reference) {
      const key = diagnostic.reference
      if (attempted.has(`directory:${key}`)) continue
      attempted.add(`directory:${key}`)
      try {
        if (!input.readRelativeDirectory) continue
        for (const [name, bytes] of await input.readRelativeDirectory(key)) {
          if (!files.has(name)) { files.set(name, bytes); added = true }
        }
        closedDirectories.add(key); added = true
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        unreadable.set(key, error instanceof Error ? error.message : String(error))
      }
    }
    for (const diagnostic of missing) {
      const key = diagnostic.reference!
      if (files.has(key) || attempted.has(key)) continue
      attempted.add(key)
      try {
        const bytes = await input.readRelative?.(key)
        if (!bytes) continue
        files.set(key, bytes)
        added = true
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        unreadable.set(key, error instanceof Error ? error.message : String(error))
      }
    }
    if (!added) break
    result = await extract({ html: input.html, siblingFiles: files, closedDirectories })
  }
  for (const [reference, message] of unreadable) result.diagnostics.push({ level: 'warning', code: 'resource-read', reference, message: `无法读取相对资源 ${reference}：${message}；原引用与其他可用内容已保留` })
  const references = new Set(result.localReferences)
  return { ...result, siblingFiles: new Map([...files].filter(([key]) => references.has(key))) }
}

/** New files use disk; authorized open bindings can supply their current source
 * even after the original file disappears. Both keep the same realpath root. */
export async function readHtmlClosure(input: ReadHtmlClosureInput): Promise<ReadHtmlClosureResult> {
  if (!isAbsolute(input.htmlPath)) {
    if (input.sourceHtml === undefined || input.rootDir) throw new Error('未绑定 HTML 只能从当前正文导入自包含资源')
    return captureHtmlClosure({ html: input.sourceHtml })
  }
  const selected = await resolveSourceInputPath(input.htmlPath), htmlFile = selected.filename
  const base = dirname(htmlFile)
  const root = (await resolveSourceInputPath(input.rootDir ?? base)).filename
  if (!confined(root, htmlFile)) throw new Error('HTML 文件不在批准的资源根目录内')
  const current = input.sourceHtml === undefined || selected.missing ? await input.currentSource?.(htmlFile) : undefined
  // An explicit body is content, not proof that a missing path is an open source.
  if (selected.missing && current === undefined) throw selected.missing
  const html = input.sourceHtml ?? current ?? (await readFile(htmlFile)).toString('utf8')
  return captureHtmlClosure({ html, readRelativeDirectory: reference => readHtmlMediaDirectory(base, root, reference), readRelative: async reference => {
    const filename = resolve(base, reference)
    if (!confined(root, filename)) return undefined
    const target = await resolveSourceInputPath(filename)
    if (!confined(root, target.filename)) return undefined
    const current = await input.currentSource?.(target.filename)
    if (current !== undefined) return new TextEncoder().encode(current)
    if (target.missing) throw target.missing
    return new Uint8Array(await readFile(target.filename))
  } })
}

export { validateHtmlImport }

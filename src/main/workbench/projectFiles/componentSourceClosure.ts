import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Loader } from 'esbuild'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import { moduleImportReferences } from '../contentApply/compilation/compileHtmlModules'
import { componentModuleFileExtensions, componentModuleSpecifier } from '../../../core/components/source/moduleSpecifier'
import { loadRuntimeEsbuild } from '../componentCompilerRuntime'
import { captureHtmlClosure, readHtmlClosure, resolveSourceInputPath } from '../htmlImport/readHtmlClosure'
import { isManagedHtmlMediaPath } from '../htmlImport/extractHtmlResources'
import type { ImportDiagnostic } from '../htmlImport/types'

const codeLoaders: Record<string, Loader> = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx', '.ts': 'ts', '.tsx': 'tsx' }
const slash = (value: string) => value.split(path.sep).join('/')

/** The file boundary captures supplied relative modules; the compiler still owns their validity. */
export async function readComponentSourceClosure(input: {
  filename: string; rootDir: string; bytes: Uint8Array; text: string; signal?: AbortSignal,
  currentSource?(filename: string): Promise<string | undefined>
}): Promise<{ entry: string; files: ReadonlyMap<string, Uint8Array>; diagnostics: ImportDiagnostic[] }> {
  const root = (await resolveSourceInputPath(input.rootDir)).filename
  const selected = await resolveSourceInputPath(input.filename), filename = selected.filename
  if (!isInsideRoot(root, filename)) throw new Error('组件源码入口位于授权资源根目录外')
  if (selected.missing && await input.currentSource?.(filename) === undefined) throw selected.missing
  const entry = slash(path.relative(root, filename)), files = new Map<string, Uint8Array>([[entry, input.bytes]])
  const analysisSources = new Map<string, Uint8Array>()
  const pending = [entry], diagnostics: ImportDiagnostic[] = []
  while (pending.length) {
    input.signal?.throwIfAborted()
    const name = pending.shift()!, bytes = files.get(name)!, loader = codeLoaders[path.posix.extname(name).toLowerCase()]
    if (path.posix.extname(name).toLowerCase() === '.css') {
      const css = name === entry ? input.text : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const closure = await readHtmlClosure({ htmlPath: path.resolve(root, name), rootDir: root,
        sourceHtml: `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`, currentSource: input.currentSource })
      diagnostics.push(...closure.diagnostics)
      for (const [relative, content] of closure.siblingFiles) {
        const logical = path.posix.normalize(path.posix.join(path.posix.dirname(name), relative))
        if (!files.has(logical)) { files.set(logical, content); pending.push(logical) }
      }
      continue
    }
    if (!loader) continue
    let references: ReturnType<typeof moduleImportReferences>
    try {
      let text = name === entry ? input.text : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      try { references = moduleImportReferences(text, { commonJs: true }) }
      catch {
        const { transform } = await loadRuntimeEsbuild()
        const output = await transform(text, { loader, format: 'esm', target: 'es2022', sourcefile: name })
        text = output.code
        references = moduleImportReferences(text, { commonJs: true })
      }
      analysisSources.set(name, new TextEncoder().encode(text))
    } catch {
      // Syntax/encoding failures remain in original bytes and are diagnosed by compilation.
      continue
    }
    for (const { reference } of references) {
      if (reference === undefined || !(reference.startsWith('./') || reference.startsWith('../'))) continue
      // Capture original bytes even when an alternate loader needs a compile diagnostic.
      const { pathname } = componentModuleSpecifier(reference)
      const base = path.posix.join(path.posix.dirname(name), pathname)
      let captured = false
      for (const extension of componentModuleFileExtensions) {
        input.signal?.throwIfAborted()
        const logical = `${base}${extension}`, requested = path.resolve(root, logical)
        if (!isInsideRoot(root, requested)) continue
        if (files.has(logical)) { captured = true; break }
        let actual: Awaited<ReturnType<typeof resolveSourceInputPath>>
        try {
          actual = await resolveSourceInputPath(requested)
          if (!isInsideRoot(root, actual.filename)) continue
        } catch { continue }
        const current = await input.currentSource?.(actual.filename)
        let content: Uint8Array
        try { content = current === undefined ? new Uint8Array(await fs.readFile(actual.filename)) : new TextEncoder().encode(current) }
        catch { continue }
        if (!files.has(logical)) { files.set(logical, content); pending.push(logical) }
        captured = true
        break
      }
      if (!captured) diagnostics.push({ level: 'warning', code: 'missing-source-dependency', reference,
        message: `无法读取组件源码 ${name} 的相对依赖 ${reference}；原源码与其他可用依赖已保留，可补充或修正该文件后继续采用` })
    }
  }
  if (analysisSources.size) {
    const html = [...analysisSources.keys()].map(name => `<script type="module" src="./${name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></script>`).join('')
    const media = await captureHtmlClosure({ html, siblingFiles: new Map([...files, ...analysisSources]), readRelative: async reference => {
      if (!isManagedHtmlMediaPath(reference)) return undefined
      input.signal?.throwIfAborted()
      const requested = path.resolve(root, reference)
      if (!isInsideRoot(root, requested)) return undefined
      const actual = await resolveSourceInputPath(requested)
      if (!isInsideRoot(root, actual.filename)) return undefined
      const current = await input.currentSource?.(actual.filename)
      return current === undefined ? new Uint8Array(await fs.readFile(actual.filename)) : new TextEncoder().encode(current)
    } })
    // Analysis may use transpiled text, but the admitted owner keeps every original source byte.
    for (const [name, bytes] of media.siblingFiles) if (!files.has(name) && isManagedHtmlMediaPath(name)) files.set(name, bytes)
    diagnostics.push(...media.diagnostics.filter(issue => issue.reference && isManagedHtmlMediaPath(issue.reference)))
  }
  return { entry, files, diagnostics }
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Loader } from 'esbuild'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import { moduleImportReferences } from '../contentApply/compilation/compileHtmlModules'
import { componentModuleFileExtensions } from '../contentApply/compilation/esbuildComponentCompiler'
import { loadRuntimeEsbuild } from '../componentCompilerRuntime'

const codeLoaders: Record<string, Loader> = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx', '.ts': 'ts', '.tsx': 'tsx' }
const slash = (value: string) => value.split(path.sep).join('/')

/** The file boundary captures supplied relative modules; the compiler still owns their validity. */
export async function readComponentSourceClosure(input: {
  filename: string; rootDir: string; bytes: Uint8Array; text: string; signal?: AbortSignal,
}): Promise<{ entry: string; files: ReadonlyMap<string, Uint8Array> }> {
  const root = await fs.realpath(input.rootDir), filename = await fs.realpath(input.filename)
  if (!isInsideRoot(root, filename)) throw new Error('组件源码入口位于授权资源根目录外')
  const entry = slash(path.relative(root, filename)), files = new Map<string, Uint8Array>([[entry, input.bytes]])
  const pending = [entry]
  while (pending.length) {
    input.signal?.throwIfAborted()
    const name = pending.shift()!, bytes = files.get(name)!, loader = codeLoaders[path.posix.extname(name).toLowerCase()]
    if (!loader) continue
    let references: ReturnType<typeof moduleImportReferences>
    try {
      const text = name === entry ? input.text : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      try { references = moduleImportReferences(text, { commonJs: true }) }
      catch {
        const { transform } = await loadRuntimeEsbuild()
        const output = await transform(text, { loader, format: 'esm', target: 'es2022', sourcefile: name })
        references = moduleImportReferences(output.code, { commonJs: true })
      }
    } catch {
      // Syntax/encoding failures remain in original bytes and are diagnosed by compilation.
      continue
    }
    for (const { reference } of references) {
      if (reference === undefined || !(reference.startsWith('./') || reference.startsWith('../'))) continue
      const base = path.posix.join(path.posix.dirname(name), reference)
      for (const extension of componentModuleFileExtensions) {
        input.signal?.throwIfAborted()
        const logical = `${base}${extension}`, requested = path.resolve(root, logical)
        if (!isInsideRoot(root, requested)) continue
        if (files.has(logical)) break
        let actual: string, content: Uint8Array
        try {
          actual = await fs.realpath(requested)
          if (!isInsideRoot(root, actual)) continue
          content = new Uint8Array(await fs.readFile(actual))
        } catch { continue }
        if (!files.has(logical)) { files.set(logical, content); pending.push(logical) }
        break
      }
    }
  }
  return { entry, files }
}

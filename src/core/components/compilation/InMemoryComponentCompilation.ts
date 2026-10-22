import type {
  ComponentCompilationInput, ComponentCompilationResult, ComponentCompiler,
  ComponentCompilerResult, ComponentModuleLoadPort, ComponentModuleLoadResult,
} from './types'
import { createHash } from 'node:crypto'
import { browserCompatibilityTarget } from '../../../shared/browser/browserCompatibility'

function sortedFiles(files: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]]))
}

function snapshot(input: ComponentCompilationInput): ComponentCompilationInput {
  return {
    entry: input.entry,
    ...(input.rootDefinitionId ? { rootDefinitionId: input.rootDefinitionId } : {}),
    ...(input.entryLanguage ? { entryLanguage: input.entryLanguage } : {}),
    ...(input.moduleEntries ? { moduleEntries: [...input.moduleEntries] } : {}),
    files: sortedFiles(input.files),
    ...(input.binaryFiles ? { binaryFiles: Object.fromEntries(Object.entries(input.binaryFiles).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, Uint8Array.from(bytes)])) } : {}),
    ...(input.moduleBindings ? { moduleBindings: sortedFiles(input.moduleBindings) } : {}),
    ...(input.htmlModuleBindings ? { htmlModuleBindings: sortedFiles(input.htmlModuleBindings) } : {}),
    ...(input.htmlModuleDocuments ? { htmlModuleDocuments: input.htmlModuleDocuments.map(document => ({ namespace: document.namespace,
      entries: [...document.entries], bindings: sortedFiles(document.bindings) })) } : {}),
    dependencies: Object.fromEntries(Object.entries(input.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, dependency]) => [name, {
      version: dependency.version, entry: dependency.entry, files: sortedFiles(dependency.files),
      ...(dependency.entryLanguage ? { entryLanguage: dependency.entryLanguage } : {}),
      ...(dependency.binaryFiles ? { binaryFiles: Object.fromEntries(Object.entries(dependency.binaryFiles).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, Uint8Array.from(bytes)])) } : {}),
      ...(dependency.moduleBindings ? { moduleBindings: sortedFiles(dependency.moduleBindings) } : {}),
    }])),
    options: {
      preserveModules: input.options?.preserveModules ?? false,
      preserveScript: input.options?.preserveScript ?? false,
      target: input.options?.target ?? browserCompatibilityTarget,
      jsx: input.options?.jsx ?? 'automatic',
      jsxImportSource: input.options?.jsxImportSource ?? 'react',
      minify: input.options?.minify ?? false,
      sourceMap: input.options?.sourceMap ?? true,
    },
  }
}

/** Caches compilation only. Each load gets its own content-realm lease. */
export class InMemoryComponentCompilation {
  private readonly cache = new Map<string, Promise<ComponentCompilerResult>>()
  private readonly pending = new Set<Promise<ComponentCompilerResult>>()

  constructor(private readonly compiler: ComponentCompiler, private readonly capacity = 64) {}

  clear(): void { this.cache.clear() }

  private trim(): void {
    let ready = [...this.cache.values()].filter(work => !this.pending.has(work)).length
    for (const [key, work] of this.cache) {
      if (ready <= this.capacity) break
      if (!this.pending.has(work)) { this.cache.delete(key); ready-- }
    }
  }

  async compile(input: ComponentCompilationInput): Promise<ComponentCompilationResult> {
    const started = performance.now()
    const source = snapshot(input)
    // This key identifies the exact compiler input; binary bytes never become
    // millions of numeric JSON property names retained for every edit version.
    const key = createHash('sha256').update(JSON.stringify([this.compiler.identity, source], (_name, value) =>
      value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value)).digest('hex')
    const existing = this.cache.get(key)
    const work = existing ?? Promise.resolve().then(() => this.compiler.compile(source))
    if (!existing) { this.cache.set(key, work); this.pending.add(work) }
    else { this.cache.delete(key); this.cache.set(key, work) }
    try {
      const result = await work
      // Failed modules do not evict usable modules or replace their output.
      if (result.status === 'failed' && this.cache.get(key) === work) this.cache.delete(key)
      return { ...structuredClone(result), source, cacheHit: !!existing, durationMs: performance.now() - started }
    } catch (error) {
      if (this.cache.get(key) === work) this.cache.delete(key)
      return {
        status: 'failed', source, cacheHit: !!existing, durationMs: performance.now() - started,
        diagnostics: [{ stage: 'compile', severity: 'error', message: error instanceof Error ? error.message : String(error) }],
      }
    } finally { this.pending.delete(work); this.trim() }
  }

  async load<Module>(input: ComponentCompilationInput, port: ComponentModuleLoadPort<Module>): Promise<ComponentModuleLoadResult<Module>> {
    const compilation = await this.compile(input)
    if (compilation.status === 'failed') return { status: 'failed', source: compilation.source, diagnostics: compilation.diagnostics }
    try {
      const loaded = await port.load(compilation.artifact)
      let releasing: Promise<void> | undefined
      return {
        status: 'loaded', compilation, module: loaded.module,
        release() { return releasing ??= Promise.resolve().then(() => loaded.release()) },
      }
    } catch (error) {
      return {
        status: 'failed', source: compilation.source,
        diagnostics: [{ stage: 'load', severity: 'error', file: compilation.source.entry, message: error instanceof Error ? error.message : String(error) }],
      }
    }
  }
}

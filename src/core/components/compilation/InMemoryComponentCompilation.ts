import type {
  ComponentCompilationInput, ComponentCompilationResult, ComponentCompiler,
  ComponentCompilerResult, ComponentModuleLoadPort, ComponentModuleLoadResult,
} from './types'

function sortedFiles(files: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]]))
}

function snapshot(input: ComponentCompilationInput): ComponentCompilationInput {
  return {
    entry: input.entry,
    ...(input.moduleEntries ? { moduleEntries: [...input.moduleEntries] } : {}),
    files: sortedFiles(input.files),
    ...(input.moduleBindings ? { moduleBindings: sortedFiles(input.moduleBindings) } : {}),
    dependencies: Object.fromEntries(Object.entries(input.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, dependency]) => [name, {
      version: dependency.version, entry: dependency.entry, files: sortedFiles(dependency.files),
      ...(dependency.moduleBindings ? { moduleBindings: sortedFiles(dependency.moduleBindings) } : {}),
    }])),
    options: {
      preserveModules: input.options?.preserveModules ?? false,
      target: input.options?.target ?? 'es2022',
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

  constructor(private readonly compiler: ComponentCompiler) {}

  clear(): void { this.cache.clear() }

  async compile(input: ComponentCompilationInput): Promise<ComponentCompilationResult> {
    const source = snapshot(input)
    const key = JSON.stringify([this.compiler.identity, source])
    const started = performance.now()
    const existing = this.cache.get(key)
    const work = existing ?? Promise.resolve().then(() => this.compiler.compile(source))
    if (!existing) this.cache.set(key, work)
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
    }
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

/** Transient compiler input. The document/resource owner supplies these files. */
export interface ComponentModuleSource {
  entry: string
  /** Declared source language applies to this owner's entry; sibling file types keep their authored extensions. */
  entryLanguage?: 'javascript' | 'typescript'
  files: Readonly<Record<string, string>>
  /** Opaque source-workspace siblings, supplied unchanged for CSS url() consumers. */
  binaryFiles?: Readonly<Record<string, Uint8Array>>
  /** Import spelling is author content; its software binding belongs to this source owner. */
  moduleBindings?: Readonly<Record<string, string>>
}

/** Exact import specifiers resolved by the resource owner, never ambient Node resolution. */
export interface ComponentModuleDependency extends ComponentModuleSource {
  version: string
}

export interface ComponentCompilationInput extends ComponentModuleSource {
  /** HTML module entries share one native graph, including URL query/fragment identity. */
  moduleEntries?: readonly string[]
  dependencies?: Readonly<Record<string, ComponentModuleDependency>>
  options?: {
    /** Preserve local HTML module boundaries and native browser evaluation semantics. */
    preserveModules?: boolean
    target?: string
    jsx?: 'transform' | 'automatic' | 'preserve'
    jsxImportSource?: string
    minify?: boolean
    sourceMap?: boolean
  }
}

export interface ComponentCompilationDiagnostic {
  stage: 'compile' | 'load'
  severity: 'error' | 'warning'
  message: string
  file?: string
  line?: number
  /** Zero based, matching compiler source locations. */
  column?: number
  lineText?: string
}

export interface CompiledJavaScriptModule {
  code: string
  /** String literal ranges in emitted code; the realm assigns its own render namespace. */
  imports: Array<{ start: number; end: number; path: string }>
}

/** Rebuildable output; never a package, persisted author state, or an executing instance. */
export interface CompiledComponentModule {
  format: 'esm'
  modules?: Record<string, CompiledJavaScriptModule>
  code: string
  css: string
  diagnostics: readonly ComponentCompilationDiagnostic[]
}

export type ComponentCompilerResult =
  | { status: 'ready'; artifact: CompiledComponentModule }
  | { status: 'failed'; diagnostics: readonly ComponentCompilationDiagnostic[] }

export interface ComponentCompiler {
  /** Include compiler implementation/version in cache identity. */
  identity: string
  compile(input: ComponentCompilationInput): Promise<ComponentCompilerResult>
}

export type ComponentCompilationResult = ComponentCompilerResult & {
  source: ComponentCompilationInput
  cacheHit: boolean
  durationMs: number
}

/** Implemented inside the actual content realm, never by evaluating source in Main. */
export interface ComponentModuleLoadPort<Module> {
  load(artifact: CompiledComponentModule): Promise<{
    module: Module
    release(): void | Promise<void>
  }>
}

export type ComponentModuleLoadResult<Module> =
  | { status: 'loaded'; compilation: ComponentCompilationResult; module: Module; release(): Promise<void> }
  | { status: 'failed'; source: ComponentCompilationInput; diagnostics: readonly ComponentCompilationDiagnostic[] }

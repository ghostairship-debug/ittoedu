export type IndexedImportKind = 'static' | 'dynamic'

export interface IndexedImport {
  kind: IndexedImportKind
  moduleSpecifier: string
  isTypeOnly: boolean
  line: number
}

export type IndexedExportKind =
  | 'declaration'
  | 'named'
  | 'namespace'
  | 'all'
  | 'assignment'

export interface IndexedExport {
  kind: IndexedExportKind
  names: readonly string[]
  moduleSpecifier?: string
  isTypeOnly: boolean
  isDefault: boolean
  line: number
}

export type IndexedTopLevelSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'const'
  | 'let'
  | 'var'
  | 'enum'
  | 'namespace'

export interface IndexedTopLevelSymbol {
  name: string
  kind: IndexedTopLevelSymbolKind
  line: number
  endLine: number
  exported: boolean
  isDefault: boolean
  jsDoc?: string
}

export type IndexedTestKind = 'describe' | 'it' | 'test'

export interface IndexedTestCase {
  kind: IndexedTestKind
  name: string
  line: number
}

export interface IndexedSourceFile {
  path: string
  projects: readonly string[]
  imports: readonly IndexedImport[]
  exports: readonly IndexedExport[]
  symbols: readonly IndexedTopLevelSymbol[]
  tests: readonly IndexedTestCase[]
}

export interface IndexedFileMembership {
  path: string
  projects: readonly string[]
}

export interface TypeScriptIndexAdapter {
  loadProjects(tsconfigPaths: readonly string[]): void
  listFiles(): readonly IndexedFileMembership[]
  scanFile(path: string): IndexedSourceFile
  dispose(): void
}

import { isAbsolute, relative, resolve } from 'node:path'
import { API } from 'typescript/unstable/sync'
import {
  NodeFlags,
  SyntaxKind,
  isArrayBindingPattern,
  isCallExpression,
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isExternalModuleReference,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isInterfaceDeclaration,
  isModuleDeclaration,
  isNamedExports,
  isNamespaceExport,
  isNamespaceExportDeclaration,
  isNoSubstitutionTemplateLiteral,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableStatement,
  type BindingName,
  type Expression,
  type Node,
  type SourceFile,
} from 'typescript/unstable/ast'

import type {
  IndexedExport,
  IndexedFileMembership,
  IndexedImport,
  IndexedSourceFile,
  IndexedTestCase,
  IndexedTestKind,
  IndexedTopLevelSymbol,
  IndexedTopLevelSymbolKind,
  TypeScriptIndexAdapter,
} from './model'

interface TypeScriptIndexAdapterOptions {
  repoRoot?: string
}

interface LoadedFile {
  displayPath: string
  projects: Set<string>
  sourceNamesByProject: Map<string, string>
}

const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?ts|tsx)$/i

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function isWindowsLikePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path)
}

function comparisonKey(path: string): string {
  const normalized = stripTrailingSlash(toSlashes(path))
  return process.platform === 'win32' || isWindowsLikePath(normalized)
    ? normalized.toLocaleLowerCase('en-US')
    : normalized
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function moduleText(expression: Expression | undefined): string | undefined {
  if (!expression) {
    return undefined
  }
  if (isStringLiteral(expression) || isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text
  }
  return undefined
}

function lineOf(sourceFile: SourceFile, node: Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function endLineOf(sourceFile: SourceFile, node: Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
}

function hasModifier(node: Node, kind: SyntaxKind): boolean {
  const modifiers = 'modifiers' in node ? node.modifiers : undefined
  return Array.isArray(modifiers) && modifiers.some((modifier) => modifier.kind === kind)
}

function firstJsDocParagraph(sourceFile: SourceFile, node: Node): string | undefined {
  const trivia = sourceFile.text.slice(node.getFullStart(), node.getStart(sourceFile))
  const matches = [...trivia.matchAll(/\/\*\*([\s\S]*?)\*\//g)]
  const last = matches.at(-1)?.[1]
  if (!last) {
    return undefined
  }

  const cleanedLines = last
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trimEnd())

  const paragraph: string[] = []
  let started = false
  for (const line of cleanedLines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('@')) {
      break
    }
    if (trimmed.length === 0) {
      if (started) {
        break
      }
      continue
    }
    started = true
    paragraph.push(trimmed)
  }

  return paragraph.length > 0 ? paragraph.join(' ') : undefined
}

function bindingNames(name: BindingName): string[] {
  if (isIdentifier(name)) {
    return [name.text]
  }
  if (isObjectBindingPattern(name) || isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      'name' in element && element.name ? bindingNames(element.name) : [],
    )
  }
  return []
}

function declarationNames(node: Node): string[] {
  if (isVariableStatement(node)) {
    return node.declarationList.declarations.flatMap((declaration) =>
      bindingNames(declaration.name),
    )
  }
  if (
    isFunctionDeclaration(node) ||
    isClassDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isTypeAliasDeclaration(node) ||
    isEnumDeclaration(node)
  ) {
    return node.name ? [node.name.text] : []
  }
  if (isModuleDeclaration(node)) {
    return [node.name.text]
  }
  return []
}

function variableKind(flags: NodeFlags): IndexedTopLevelSymbolKind {
  if ((flags & NodeFlags.Const) !== 0) {
    return 'const'
  }
  if ((flags & NodeFlags.Let) !== 0) {
    return 'let'
  }
  return 'var'
}

function symbolKind(node: Node): IndexedTopLevelSymbolKind | undefined {
  if (isFunctionDeclaration(node)) return 'function'
  if (isClassDeclaration(node)) return 'class'
  if (isInterfaceDeclaration(node)) return 'interface'
  if (isTypeAliasDeclaration(node)) return 'type'
  if (isVariableStatement(node)) return variableKind(node.declarationList.flags)
  if (isEnumDeclaration(node)) return 'enum'
  if (isModuleDeclaration(node)) return 'namespace'
  return undefined
}

function collectSymbols(sourceFile: SourceFile): IndexedTopLevelSymbol[] {
  const symbols: IndexedTopLevelSymbol[] = []

  for (const statement of sourceFile.statements) {
    const kind = symbolKind(statement)
    if (!kind) {
      continue
    }
    const exported = hasModifier(statement, SyntaxKind.ExportKeyword)
    const isDefault = hasModifier(statement, SyntaxKind.DefaultKeyword)
    const names = declarationNames(statement)
    if (names.length === 0 && isDefault) {
      names.push('default')
    }
    for (const name of names) {
      symbols.push({
        name,
        kind,
        line: lineOf(sourceFile, statement),
        endLine: endLineOf(sourceFile, statement),
        exported,
        isDefault,
        jsDoc: firstJsDocParagraph(sourceFile, statement),
      })
    }
  }

  return symbols.sort((left, right) =>
    left.line - right.line || compareText(left.name, right.name),
  )
}

function collectImports(sourceFile: SourceFile): IndexedImport[] {
  const imports: IndexedImport[] = []

  for (const statement of sourceFile.statements) {
    if (isImportDeclaration(statement)) {
      const moduleSpecifier = moduleText(statement.moduleSpecifier)
      if (moduleSpecifier) {
        imports.push({
          kind: 'static',
          moduleSpecifier,
          isTypeOnly: statement.importClause?.phaseModifier === SyntaxKind.TypeKeyword,
          line: lineOf(sourceFile, statement),
        })
      }
    } else if (
      isImportEqualsDeclaration(statement) &&
      isExternalModuleReference(statement.moduleReference)
    ) {
      const moduleSpecifier = moduleText(statement.moduleReference.expression)
      if (moduleSpecifier) {
        imports.push({
          kind: 'static',
          moduleSpecifier,
          isTypeOnly: statement.isTypeOnly,
          line: lineOf(sourceFile, statement),
        })
      }
    }
  }

  const visit = (node: Node): void => {
    if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
      const moduleSpecifier = moduleText(node.arguments[0])
      if (moduleSpecifier) {
        imports.push({
          kind: 'dynamic',
          moduleSpecifier,
          isTypeOnly: false,
          line: lineOf(sourceFile, node),
        })
      }
    }
    node.forEachChild((child) => {
      visit(child)
      return undefined
    })
  }
  visit(sourceFile)

  return imports.sort((left, right) =>
    left.line - right.line ||
    compareText(left.kind, right.kind) ||
    compareText(left.moduleSpecifier, right.moduleSpecifier),
  )
}

function collectExports(sourceFile: SourceFile): IndexedExport[] {
  const exports: IndexedExport[] = []

  for (const statement of sourceFile.statements) {
    if (isExportDeclaration(statement)) {
      const moduleSpecifier = moduleText(statement.moduleSpecifier)
      const exportClause = statement.exportClause
      const names = exportClause && isNamedExports(exportClause)
        ? exportClause.elements.map((element) => element.name.text)
        : exportClause && isNamespaceExport(exportClause)
          ? [exportClause.name.text]
          : []
      exports.push({
        kind: exportClause && isNamedExports(exportClause)
          ? 'named'
          : exportClause && isNamespaceExport(exportClause)
            ? 'namespace'
            : 'all',
        names: [...names].sort(compareText),
        ...(moduleSpecifier ? { moduleSpecifier } : {}),
        isTypeOnly: statement.isTypeOnly,
        isDefault: false,
        line: lineOf(sourceFile, statement),
      })
      continue
    }

    if (isExportAssignment(statement)) {
      exports.push({
        kind: 'assignment',
        names: [statement.isExportEquals ? 'export=' : 'default'],
        isTypeOnly: false,
        isDefault: !statement.isExportEquals,
        line: lineOf(sourceFile, statement),
      })
      continue
    }

    if (isNamespaceExportDeclaration(statement)) {
      exports.push({
        kind: 'namespace',
        names: [statement.name.text],
        isTypeOnly: true,
        isDefault: false,
        line: lineOf(sourceFile, statement),
      })
      continue
    }

    if (!hasModifier(statement, SyntaxKind.ExportKeyword)) {
      continue
    }
    const names = declarationNames(statement)
    const isDefault = hasModifier(statement, SyntaxKind.DefaultKeyword)
    exports.push({
      kind: 'declaration',
      names: names.length > 0 ? [...names].sort(compareText) : isDefault ? ['default'] : [],
      isTypeOnly:
        isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement),
      isDefault,
      line: lineOf(sourceFile, statement),
    })
  }

  return exports.sort((left, right) =>
    left.line - right.line ||
    compareText(left.kind, right.kind) ||
    compareText(left.names.join('\0'), right.names.join('\0')),
  )
}

function callBaseName(expression: Expression): string | undefined {
  if (isIdentifier(expression)) {
    return expression.text
  }
  if (isPropertyAccessExpression(expression)) {
    return callBaseName(expression.expression)
  }
  if (isCallExpression(expression)) {
    return callBaseName(expression.expression)
  }
  return undefined
}

function isTestKind(value: string | undefined): value is IndexedTestKind {
  return value === 'describe' || value === 'it' || value === 'test'
}

function collectTests(sourceFile: SourceFile): IndexedTestCase[] {
  const tests: IndexedTestCase[] = []

  const visit = (node: Node, suite: readonly string[]): void => {
    let childSuite = suite
    if (isCallExpression(node)) {
      const kind = callBaseName(node.expression)
      const name = moduleText(node.arguments[0])
      if (isTestKind(kind) && name !== undefined) {
        tests.push({ kind, name, line: lineOf(sourceFile, node), suite })
        if (kind === 'describe') {
          childSuite = [...suite, name]
        }
      }
    }
    node.forEachChild((child) => {
      visit(child, childSuite)
      return undefined
    })
  }
  visit(sourceFile, [])

  return tests.sort((left, right) =>
    left.line - right.line ||
    compareText(left.kind, right.kind) ||
    compareText(left.name, right.name),
  )
}

class OfficialTypeScriptIndexAdapter implements TypeScriptIndexAdapter {
  private readonly repoRoot: string
  private readonly repoRootKey: string
  private api: API | undefined
  private snapshot: ReturnType<API['updateSnapshot']> | undefined
  private files = new Map<string, LoadedFile>()
  private projects = new Map<string, ReturnType<NonNullable<typeof this.snapshot>['getProjects']>[number]>()
  private disposed = false

  constructor(options: TypeScriptIndexAdapterOptions) {
    this.repoRoot = stripTrailingSlash(toSlashes(resolve(options.repoRoot ?? process.cwd())))
    this.repoRootKey = comparisonKey(this.repoRoot)
  }

  loadProjects(tsconfigPaths: readonly string[]): void {
    this.ensureUsable()
    if (tsconfigPaths.length === 0) {
      throw new Error('At least one tsconfig path is required')
    }
    this.closeLoadedState()

    const configPaths = [...new Set(tsconfigPaths.map((path) => this.absolutePath(path)))]
      .sort(compareText)
    try {
      this.api = new API({ cwd: this.repoRoot })
      this.snapshot = this.api.updateSnapshot({ openProjects: configPaths })

      const expectedConfigKeys = new Set(configPaths.map(comparisonKey))
      const loadedConfigKeys = new Set<string>()

      for (const project of this.snapshot.getProjects()) {
        const configAbsolute = this.absolutePath(project.configFileName)
        const configKey = comparisonKey(configAbsolute)
        if (!expectedConfigKeys.has(configKey)) {
          continue
        }
        loadedConfigKeys.add(configKey)
        const projectPath = this.relativePath(configAbsolute)
        this.projects.set(projectPath, project)

        for (const sourceName of project.program.getSourceFileNames()) {
          const absoluteSource = this.absolutePath(sourceName)
          if (!this.isRepositorySource(absoluteSource)) {
            continue
          }
          const displayPath = this.relativePath(absoluteSource)
          const key = comparisonKey(displayPath)
          const loaded = this.files.get(key) ?? {
            displayPath,
            projects: new Set<string>(),
            sourceNamesByProject: new Map<string, string>(),
          }
          if (compareText(displayPath, loaded.displayPath) < 0) {
            loaded.displayPath = displayPath
          }
          loaded.projects.add(projectPath)
          loaded.sourceNamesByProject.set(projectPath, sourceName)
          this.files.set(key, loaded)
        }
      }

      const missing = configPaths.filter((path) => !loadedConfigKeys.has(comparisonKey(path)))
      if (missing.length > 0) {
        throw new Error(`TypeScript did not load configured projects: ${missing.join(', ')}`)
      }
    } catch (error) {
      this.closeLoadedState()
      throw error
    }
  }

  listFiles(): readonly IndexedFileMembership[] {
    this.ensureLoaded()
    return [...this.files.values()]
      .map((file) => ({
        path: file.displayPath,
        projects: [...file.projects].sort(compareText),
      }))
      .sort((left, right) => compareText(left.path, right.path))
  }

  scanFile(path: string): IndexedSourceFile {
    this.ensureLoaded()
    const relativePath = this.relativePath(this.absolutePath(path))
    const loaded = this.files.get(comparisonKey(relativePath))
    if (!loaded) {
      throw new Error(`File is not part of a loaded TypeScript project: ${path}`)
    }

    const projects = [...loaded.projects].sort(compareText)
    const projectPath = projects[0]
    const project = this.projects.get(projectPath)
    const sourceName = loaded.sourceNamesByProject.get(projectPath)
    const sourceFile = project && sourceName
      ? project.program.getSourceFile(sourceName)
      : undefined
    if (!sourceFile) {
      throw new Error(`TypeScript source file is unavailable: ${loaded.displayPath}`)
    }

    return {
      path: loaded.displayPath,
      projects,
      imports: collectImports(sourceFile),
      exports: collectExports(sourceFile),
      symbols: collectSymbols(sourceFile),
      tests: collectTests(sourceFile),
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.closeLoadedState()
    this.disposed = true
  }

  private absolutePath(path: string): string {
    const slashed = toSlashes(path)
    return stripTrailingSlash(toSlashes(isAbsolute(path) ? resolve(path) : resolve(this.repoRoot, slashed)))
  }

  private relativePath(absolutePath: string): string {
    const relativePath = toSlashes(relative(this.repoRoot, absolutePath))
    if (relativePath === '' || relativePath === '.') {
      return '.'
    }
    if (relativePath === '..' || relativePath.startsWith('../')) {
      throw new Error(`Path is outside repository root: ${absolutePath}`)
    }
    return relativePath.replace(/^\.\//, '')
  }

  private isRepositorySource(absolutePath: string): boolean {
    const absoluteKey = comparisonKey(absolutePath)
    if (absoluteKey !== this.repoRootKey && !absoluteKey.startsWith(`${this.repoRootKey}/`)) {
      return false
    }
    const relativePath = this.relativePath(absolutePath)
    return (
      SOURCE_EXTENSION_PATTERN.test(relativePath) &&
      !relativePath.split('/').some((segment) =>
        segment === 'node_modules' ||
        segment === 'release' ||
        segment === 'dist' ||
        segment.startsWith('dist-'),
      )
    )
  }

  private ensureUsable(): void {
    if (this.disposed) {
      throw new Error('TypeScript index adapter has been disposed')
    }
  }

  private ensureLoaded(): void {
    this.ensureUsable()
    if (!this.snapshot) {
      throw new Error('TypeScript projects have not been loaded')
    }
  }

  private closeLoadedState(): void {
    this.snapshot?.dispose()
    this.snapshot = undefined
    this.api?.close()
    this.api = undefined
    this.files.clear()
    this.projects.clear()
  }
}

export function createTypeScriptIndexAdapter(
  options: TypeScriptIndexAdapterOptions = {},
): TypeScriptIndexAdapter {
  return new OfficialTypeScriptIndexAdapter(options)
}

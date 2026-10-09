import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { API, type Snapshot } from 'typescript/unstable/sync'
import { SyntaxKind, isCallExpression, isExportDeclaration, isImportDeclaration, isNamedExports, isNamedImports,
  isNamespaceExport, isNamespaceImport, isStringLiteral, type ImportClause, type Node, type SourceFile } from 'typescript/unstable/ast'
import { afterAll, beforeAll, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const sourcePathByText = new Map<string, string>()
const parsedSources = new Map<string, SourceFile>()
let typeScriptApi: API | undefined
let typeScriptSnapshot: Snapshot | undefined

beforeAll(() => {
  typeScriptApi = new API({ cwd: root })
  typeScriptSnapshot = typeScriptApi.updateSnapshot({
    openFiles: filesUnder('src').map(file => join(root, file)),
    openProjects: [
      join(root, 'tsconfig.json'),
      join(root, 'tsconfig.electron.json'),
    ],
  })
  for (const project of typeScriptSnapshot.getProjects()) {
    for (const sourceName of project.program.getSourceFileNames()) {
      const path = relative(root, resolve(sourceName)).replace(/\\/g, '/')
      if (path === '..' || path.startsWith('../')) continue
      const parsed = project.program.getSourceFile(sourceName)
      if (parsed) parsedSources.set(path, parsed)
    }
  }
}, 60_000)

afterAll(() => {
  typeScriptSnapshot?.dispose()
  typeScriptApi?.close()
})

function source(path: string): string {
  const text = readFileSync(join(root, path), 'utf8')
  sourcePathByText.set(text, path.replace(/\\/g, '/'))
  return text
}

function filesUnder(directory: string): string[] {
  const absolute = join(root, directory)
  const result: string[] = []
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name)
      if (entry.isDirectory()) visit(next)
      else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
        result.push(relative(root, next).replace(/\\/g, '/'))
      }
    }
  }
  visit(absolute)
  return result.sort()
}

interface ModuleReference {
  readonly specifier: string
  readonly runtime: boolean
}

function parsedSource(text: string): SourceFile {
  const path = sourcePathByText.get(text)
  const parsed = path ? parsedSources.get(path) : undefined
  if (!parsed) throw new Error(`TypeScript AST is unavailable for ${path ?? 'inline source'}`)
  return parsed
}

function importClauseHasRuntimeValue(clause: ImportClause | undefined): boolean {
  if (!clause) return true
  if (clause.phaseModifier === SyntaxKind.TypeKeyword) return false
  if (clause.name || (clause.namedBindings && isNamespaceImport(clause.namedBindings))) return true
  return clause.namedBindings && isNamedImports(clause.namedBindings)
    ? clause.namedBindings.elements.some((element) => !element.isTypeOnly)
    : false
}

function moduleReferences(text: string): ModuleReference[] {
  const parsed = parsedSource(text)
  const result: ModuleReference[] = []
  const visit = (node: Node): void => {
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      result.push({
        specifier: node.moduleSpecifier.text,
        runtime: importClauseHasRuntimeValue(node.importClause),
      })
    } else if (isExportDeclaration(node) && node.moduleSpecifier && isStringLiteral(node.moduleSpecifier)) {
      const hasRuntimeValue = !node.isTypeOnly && (
        !node.exportClause
        || isNamespaceExport(node.exportClause)
        || (isNamedExports(node.exportClause)
          && node.exportClause.elements.some((element) => !element.isTypeOnly))
      )
      result.push({ specifier: node.moduleSpecifier.text, runtime: hasRuntimeValue })
    } else if (
      isCallExpression(node)
      && node.expression.kind === SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && isStringLiteral(node.arguments[0]!)
    ) {
      result.push({ specifier: node.arguments[0]!.text, runtime: true })
    }
    node.forEachChild((child) => {
      visit(child)
      return undefined
    })
  }
  visit(parsed)
  return result
}

function importSpecifiers(text: string): string[] {
  return moduleReferences(text).map(({ specifier }) => specifier)
}

function runtimeImportSpecifiers(text: string): string[] {
  return moduleReferences(text)
    .filter(({ runtime }) => runtime)
    .map(({ specifier }) => specifier)
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  const absolute = specifier.startsWith('@/')
    ? resolve(root, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(join(root, fromFile, '..'), specifier)
      : null
  if (!absolute) return null
  for (const candidate of [
    `${absolute}.ts`,
    `${absolute}.tsx`,
    join(absolute, 'index.ts'),
    join(absolute, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return relative(root, candidate).replace(/\\/g, '/')
  }
  return null
}

function directedCycles(edges: ReadonlyMap<string, readonly string[]>): string[] {
  const cycles: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const visit = (node: string): void => {
    if (visiting.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node].join(' -> '))
      return
    }
    if (visited.has(node)) return
    visiting.add(node)
    stack.push(node)
    for (const next of edges.get(node) ?? []) visit(next)
    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }
  for (const file of edges.keys()) visit(file)
  return cycles
}

function runtimeCyclesAmong(entryFiles: readonly string[]): string[] {
  const nodes = new Set(entryFiles)
  const edges = new Map<string, string[]>()
  for (const file of entryFiles) {
    edges.set(file, runtimeImportSpecifiers(source(file)).flatMap((specifier) => {
      const resolved = resolveLocalImport(file, specifier)
      return resolved && nodes.has(resolved) ? [resolved] : []
    }))
  }
  return directedCycles(edges)
}

function forbiddenImports(files: readonly string[], forbidden: RegExp): string[] {
  return files.flatMap(file => importSpecifiers(source(file)).flatMap(specifier => {
    const target = resolveLocalImport(file, specifier)
    return target && forbidden.test(target) ? [`${file} -> ${target}`] : []
  }))
}

it('keeps canonical Core independent of renderer Main and Player application layers', () => {
  expect(forbiddenImports(filesUnder('src/core'), /^src\/(?:renderer|main|player)\//)).toEqual([])
})

it('keeps Player independent of renderer Store ownership', () => {
  expect(forbiddenImports(filesUnder('src/player'), /^src\/renderer\/store\//)).toEqual([])
})

it('keeps Store slices and asynchronous feature owners independent of the root Store and of cyclic Store ownership', () => {
  const slices = filesUnder('src/renderer/store/slices')
  const features = ['src/renderer/app/useMediaImport.ts', 'src/renderer/app/useComponentLibrary.ts']
  expect(forbiddenImports([...slices, ...features, 'src/renderer/store/editorStoreKernel.ts'], /^src\/renderer\/store\/editorStore\.ts$/)).toEqual([])
  expect(runtimeCyclesAmong(filesUnder('src/renderer/store'))).toEqual([])
  expect(directedCycles(new Map([['a', ['b']], ['b', ['a']]]))).toEqual(['a -> b -> a'])
})

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { API } from 'typescript/unstable/sync'
import {
  SyntaxKind, isCallExpression, isExportDeclaration, isIdentifier, isImportDeclaration, isStringLiteral,
  type Node, type SourceFile,
} from 'typescript/unstable/ast'

export interface ImportEdge {
  from: string
  specifier: string
  to: string | null
}

export interface BoundaryViolation {
  rule: 'core-runtime' | 'renderer-cli' | 'wrapper-canvas' | 'tool-schema-source'
  detail: string
}

const slash = (path: string) => path.replaceAll('\\', '/')
const local = (path: string) => path.startsWith('src/')
const isCore = (path: string) => path.startsWith('src/core/')
const isRenderer = (path: string) => path.startsWith('src/renderer/')
const isRuntimeOwner = (path: string) => /^src\/(?:renderer|main|runtime|player)\//.test(path)
const isWrapper = (path: string) => /^src\/main\/workbench\/providers\//.test(path)
  || /^src\/main\/workbench\/images\/[^/]*Provider\.tsx?$/.test(path)
  || /^src\/main\/workbench\/external\/[^/]*(?:Mcp|MCP)[^/]*\.tsx?$/.test(path)
const isCanvas = (path: string) => /^src\/renderer\/(?:ui|course|components|runtime)\//.test(path)
  || /^src\/player\/(?:surfaces|ui|runtime)\//.test(path)
const isConcreteCli = (path: string) => /(?:^|\/)(?:localAgent|cli)(?:\/|$)/i.test(path)
  || /(?:codex|claude|opencode)[^/]*cli/i.test(path)
const cliPackages = new Set(['node:child_process', 'child_process', 'execa', 'cross-spawn',
  '@openai/codex-sdk', '@anthropic-ai/claude-agent-sdk', '@opencode-ai/sdk'])

function sourceFiles(directory: string): string[] {
  const result: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name)
      if (entry.isDirectory()) visit(next)
      else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) result.push(next)
    }
  }
  visit(directory)
  return result.sort()
}

function moduleSpecifiers(source: SourceFile): string[] {
  const found: string[] = []
  const visit = (node: Node) => {
    if ((isImportDeclaration(node) || isExportDeclaration(node))
      && node.moduleSpecifier && isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text)
    } else if (isCallExpression(node) && node.arguments.length === 1
      && isStringLiteral(node.arguments[0]!)
      && (node.expression.kind === SyntaxKind.ImportKeyword
        || isIdentifier(node.expression) && node.expression.text === 'require')) {
      found.push(node.arguments[0]!.text)
    }
    node.forEachChild(child => { visit(child); return undefined })
  }
  visit(source)
  return found
}

function resolveLocalImport(root: string, from: string, specifier: string): string | null {
  const target = specifier.startsWith('@/') ? resolve(root, 'src', specifier.slice(2))
    : specifier.startsWith('.') ? resolve(dirname(resolve(root, from)), specifier) : null
  if (!target) return null
  const candidates = /\.jsx?$/.test(target)
    ? [target.replace(/\.jsx?$/, '.ts'), target.replace(/\.jsx?$/, '.tsx')]
    : [target, `${target}.ts`, `${target}.tsx`, join(target, 'index.ts'), join(target, 'index.tsx')]
  const resolved = candidates.find(candidate => existsSync(candidate))
  if (!resolved) return null
  const path = slash(relative(root, resolved))
  return local(path) ? path : null
}

export function collectImportEdges(root: string): ImportEdge[] {
  const api = new API({ cwd: root })
  const snapshot = api.updateSnapshot({ openProjects: [join(root, 'tsconfig.json'), join(root, 'tsconfig.electron.json')] })
  const edges: ImportEdge[] = []
  try {
    const parsed = new Map<string, SourceFile>()
    for (const project of snapshot.getProjects()) {
      for (const filename of project.program.getSourceFileNames()) {
        const path = slash(relative(root, resolve(filename)))
        if (!local(path)) continue
        const source = project.program.getSourceFile(filename)
        if (source) parsed.set(path, source)
      }
    }
    for (const filename of sourceFiles(join(root, 'src'))) {
      const from = slash(relative(root, filename))
      const source = parsed.get(from)
      if (!source) throw new Error(`TypeScript AST unavailable: ${from}`)
      for (const specifier of moduleSpecifiers(source)) {
        edges.push({ from, specifier, to: resolveLocalImport(root, from, specifier) })
      }
    }
  } finally {
    snapshot.dispose()
    api.close()
  }
  return edges
}

/** These are the four S11 import boundaries, not a general architecture policy. */
export function checkImportBoundaries(edges: readonly ImportEdge[], files: ReadonlySet<string>): BoundaryViolation[] {
  const violations: BoundaryViolation[] = []
  const add = (rule: BoundaryViolation['rule'], detail: string) => violations.push({ rule, detail })
  for (const edge of edges) {
    if (isCore(edge.from) && edge.to && isRuntimeOwner(edge.to)) {
      add('core-runtime', `${edge.from} -> ${edge.to}`)
    }
    if (isRenderer(edge.from) && (edge.to && isConcreteCli(edge.to) || cliPackages.has(edge.specifier))) {
      add('renderer-cli', `${edge.from} -> ${edge.to ?? edge.specifier}`)
    }
    if (isWrapper(edge.from) && edge.to && isCanvas(edge.to)) {
      add('wrapper-canvas', `${edge.from} -> ${edge.to}`)
    }
  }

  const catalog = 'src/core/tools/ToolCatalog.ts'
  const gateway = 'src/core/tools/DocumentToolGateway.ts'
  const engine = 'src/main/workbench/execution/ExecutionEngine.ts'
  const mcp = 'src/main/workbench/external/McpDocumentServer.ts'
  const required = [[gateway, catalog], [engine, gateway], [mcp, gateway]] as const
  for (const [from, to] of required) {
    if (!files.has(from) || !files.has(to) || !edges.some(edge => edge.from === from && edge.to === to)) {
      add('tool-schema-source', `required tool definition edge missing: ${from} -> ${to}`)
    }
  }
  // Transport wrappers receive their tool schema from the Gateway. Their own
  // connection/protocol schemas are separate; only these business-tool entrypoints
  // are forbidden from declaring another domain schema or importing a second catalog.
  const toolTransports = [engine, mcp,
    'src/main/workbench/providers/OpenAIChatProvider.ts',
    'src/main/workbench/providers/ChatGPTResponsesProvider.ts']
  for (const from of toolTransports) {
    if (!files.has(from)) add('tool-schema-source', `tool transport missing: ${from}`)
    for (const edge of edges.filter(edge => edge.from === from)) {
      if (edge.specifier === 'zod' || edge.to && edge.to.startsWith('src/core/tools/') && edge.to !== gateway) {
        add('tool-schema-source', `${from} -> ${edge.to ?? edge.specifier}`)
      }
    }
  }
  return violations.sort((a, b) => a.rule.localeCompare(b.rule) || a.detail.localeCompare(b.detail))
}

export function scanImportBoundaries(root: string) {
  const edges = collectImportEdges(root)
  const files = new Set(sourceFiles(join(root, 'src')).map(filename => slash(relative(root, filename))))
  return { files: files.size, edges: edges.length, violations: checkImportBoundaries(edges, files) }
}

if (process.argv[1] && slash(resolve(process.argv[1])) === slash(resolve(dirname(__filename), 'check-g20-import-boundaries.ts'))) {
  const result = scanImportBoundaries(resolve(dirname(__filename), '..'))
  for (const violation of result.violations) process.stderr.write(`[${violation.rule}] ${violation.detail}\n`)
  process.stdout.write(`S11 import boundaries: ${result.files} source files, ${result.edges} import edges, ${result.violations.length} violations\n`)
  if (result.violations.length) process.exitCode = 1
}

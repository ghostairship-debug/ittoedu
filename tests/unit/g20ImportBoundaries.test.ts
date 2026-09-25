import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkImportBoundaries, scanImportBoundaries, type ImportEdge } from '../../scripts/check-g20-import-boundaries'

const root = resolve(__dirname, '../..')
const catalog = 'src/core/tools/ToolCatalog.ts'
const gateway = 'src/core/tools/DocumentToolGateway.ts'
const engine = 'src/main/workbench/execution/ExecutionEngine.ts'
const mcp = 'src/main/workbench/external/McpDocumentServer.ts'
const sourceChain: ImportEdge[] = [
  { from: gateway, specifier: './ToolCatalog', to: catalog },
  { from: engine, specifier: '../../../core/tools/DocumentToolGateway', to: gateway },
  { from: mcp, specifier: '../../../core/tools/DocumentToolGateway', to: gateway },
]

describe('S11 determined import boundaries', () => {
  it('resolves the real TypeScript source graph and preserves the domain schema source chain', () => {
    const report = scanImportBoundaries(root)
    expect(report.files).toBeGreaterThan(0)
    expect(report.edges).toBeGreaterThan(0)
    expect(report.violations).toEqual([])
  })

  it('reports each forbidden edge and a missing schema source edge', () => {
    const edges: ImportEdge[] = [
      sourceChain[0]!, sourceChain[1]!,
      { from: 'src/core/tools/example.ts', specifier: '../../renderer/ui/Canvas', to: 'src/renderer/ui/Canvas.tsx' },
      { from: 'src/renderer/example.ts', specifier: '../../main/localAgent/harness', to: 'src/main/localAgent/harness.ts' },
      { from: 'src/renderer/other.ts', specifier: 'node:child_process', to: null },
      { from: 'src/main/workbench/providers/OpenAIChatProvider.ts', specifier: '../../../renderer/ui/Canvas', to: 'src/renderer/ui/Canvas.tsx' },
      { from: engine, specifier: 'zod', to: null },
    ]
    const violations = checkImportBoundaries(edges, new Set([catalog, gateway, engine, mcp,
      'src/main/workbench/providers/OpenAIChatProvider.ts',
      'src/main/workbench/providers/ChatGPTResponsesProvider.ts']))
    expect(violations.map(value => value.rule)).toEqual([
      'core-runtime', 'renderer-cli', 'renderer-cli', 'tool-schema-source', 'tool-schema-source', 'wrapper-canvas',
    ])
    expect(violations.some(value => value.detail.includes(`${mcp} -> ${gateway}`))).toBe(true)
  })
})

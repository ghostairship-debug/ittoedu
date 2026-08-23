import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  checkRepoIndex,
  createFileFact,
  generateRepoIndexToDirectory,
  hashGeneratedDirectory,
  validateMarkdownLinks,
  verifyContractArtifactHash,
} from '../../scripts/repo-index/generator'
import {
  classifyInputPath,
  createInputInventoryRecord,
  hashInputBytes,
  loadRepoIndexConfig,
} from '../../scripts/repo-index/inputInventory'
import {
  readGeneratedDirectory,
  replaceGeneratedDirectoryAtomically,
  serializeJsonLines,
} from '../../scripts/repo-index/writeGenerated'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'ittoedu-repo-index-test-'))

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})

function parseJsonLines(bytes: Buffer): Record<string, unknown>[] {
  const text = bytes.toString('utf8').trim()
  return text.length === 0
    ? []
    : text.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
}

function modificationTimes(directory: string): Record<string, number> {
  return Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((name) => [name, statSync(resolve(directory, name)).mtimeMs]),
  )
}

describe('deterministic repo-index generator', () => {
  it('normalizes CRLF/LF and assigns strict inputs to one domain', () => {
    expect(hashInputBytes(Buffer.from('\uFEFFalpha\r\nbeta\r', 'utf8'))).toBe(
      hashInputBytes(Buffer.from('alpha\nbeta\n', 'utf8')),
    )

    const config = loadRepoIndexConfig(repoRoot)
    expect(classifyInputPath('src/renderer/App.tsx', config)).toBe('source')
    expect(classifyInputPath('repo-index/semantic/features.json', config)).toBe('semantic')
    expect(classifyInputPath('tsconfig.e2e.json', config)).toBe('config')
    expect(classifyInputPath('scripts/repo-index/generator.ts', config)).toBe('tool')
    expect(classifyInputPath('package-lock.json', config)).toBe('tool')

    const crlf = createInputInventoryRecord(
      'fixture.ts',
      'source',
      Buffer.from('\uFEFFalpha\r\nbeta\r', 'utf8'),
    )
    const lf = createInputInventoryRecord(
      'fixture.ts',
      'source',
      Buffer.from('alpha\nbeta\n', 'utf8'),
    )
    expect(serializeJsonLines([crlf]).equals(serializeJsonLines([lf]))).toBe(true)
    expect(
      serializeJsonLines([createFileFact(crlf)]).equals(
        serializeJsonLines([createFileFact(lf)]),
      ),
    ).toBe(true)
  })

  it('rejects a contract artifact whose bytes do not match the manifest hash', () => {
    const fixtureRoot = resolve(temporaryRoot, 'contract-hash')
    const artifactPath = 'artifacts/contracts/fixture.schema.json'
    const absoluteArtifact = resolve(fixtureRoot, artifactPath)
    mkdirSync(dirname(absoluteArtifact), { recursive: true })
    const original = Buffer.from('{"schemaVersion":1}\n', 'utf8')
    writeFileSync(absoluteArtifact, original)
    const expected = createHash('sha256').update(original).digest('hex')

    expect(() => verifyContractArtifactHash(fixtureRoot, artifactPath, expected)).not.toThrow()
    writeFileSync(absoluteArtifact, Buffer.from('{"schemaVersion":2}\n', 'utf8'))
    expect(() => verifyContractArtifactHash(fixtureRoot, artifactPath, expected)).toThrow(
      /hash mismatch/,
    )
  })

  it('validates inline/reference anchors and ignores fenced Markdown examples', () => {
    const fixtureRoot = resolve(temporaryRoot, 'markdown')
    mkdirSync(fixtureRoot, { recursive: true })
    writeFileSync(
      resolve(fixtureRoot, 'target.md'),
      '# Valid Heading\n\n## Valid Heading\n',
      'utf8',
    )
    const source = [
      '[inline](./target.md#valid-heading)',
      '[reference][target]',
      '[target]: ./target.md#valid-heading-1',
      '```md',
      '[ignored](./missing.md)',
      '[ignored-ref]: ./missing.md',
      '```',
    ].join('\n')
    writeFileSync(resolve(fixtureRoot, 'source.md'), source, 'utf8')

    expect(validateMarkdownLinks(fixtureRoot, 'source.md', source)).toEqual([
      'target.md#valid-heading',
      'target.md#valid-heading-1',
    ])
    expect(() =>
      validateMarkdownLinks(
        fixtureRoot,
        'source.md',
        '[bad](./target.md#missing-anchor)',
      )
    ).toThrow(/anchor does not exist/)
    expect(() =>
      validateMarkdownLinks(fixtureRoot, 'source.md', '[bad][undefined]')
    ).toThrow(/reference is undefined/)
  })

  it('atomically replaces an existing directory and restores it after an injected failure', () => {
    const files = new Map([['manifest.json', Buffer.from('{"new":true}\n')]])
    const successTarget = resolve(temporaryRoot, 'atomic-success/generated')
    mkdirSync(successTarget, { recursive: true })
    writeFileSync(resolve(successTarget, 'old.json'), '{"old":true}\n')
    replaceGeneratedDirectoryAtomically(successTarget, files)
    expect(readdirSync(successTarget)).toEqual(['manifest.json'])
    expect(readFileSync(resolve(successTarget, 'manifest.json'), 'utf8')).toBe('{"new":true}\n')
    expect(readdirSync(resolve(successTarget, '../contexts'))).toEqual([])

    const rollbackTarget = resolve(temporaryRoot, 'atomic-rollback/generated')
    mkdirSync(rollbackTarget, { recursive: true })
    writeFileSync(resolve(rollbackTarget, 'old.json'), '{"old":true}\n')
    expect(() =>
      replaceGeneratedDirectoryAtomically(rollbackTarget, files, {
        beforeInstall: () => {
          throw new Error('injected install failure')
        },
      })
    ).toThrow(/injected install failure/)
    expect(readdirSync(rollbackTarget)).toEqual(['old.json'])
    expect(readFileSync(resolve(rollbackTarget, 'old.json'), 'utf8')).toBe('{"old":true}\n')
    expect(readdirSync(resolve(rollbackTarget, '../contexts'))).toEqual([])
  })

  it(
    'produces byte-identical complete facts in two separate directories',
    () => {
      const firstDirectory = resolve(temporaryRoot, 'first')
      const secondDirectory = resolve(temporaryRoot, 'second')
      const firstSummary = generateRepoIndexToDirectory(repoRoot, firstDirectory)
      const secondSummary = generateRepoIndexToDirectory(repoRoot, secondDirectory)
      const first = readGeneratedDirectory(firstDirectory)
      const second = readGeneratedDirectory(secondDirectory)

      expect([...first.keys()]).toEqual([
        'contracts.json',
        'docs.json',
        'edges.jsonl',
        'files.jsonl',
        'input-inventory.jsonl',
        'manifest.json',
        'scripts.json',
        'symbols.jsonl',
        'tests.jsonl',
      ])
      expect([...first.keys()]).toEqual([...second.keys()])
      for (const [name, bytes] of first) {
        expect(bytes.equals(second.get(name)!)).toBe(true)
        expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false)
        expect(bytes.toString('utf8')).not.toContain('\r')
        expect(bytes.toString('utf8').toLowerCase()).not.toContain(
          repoRoot.replace(/\\/g, '/').toLowerCase(),
        )
      }
      expect(hashGeneratedDirectory(firstDirectory)).toBe(
        hashGeneratedDirectory(secondDirectory),
      )
      expect(firstSummary).toEqual(secondSummary)
      expect(firstSummary.outputBytes).toBeGreaterThan(0)

      const manifest = JSON.parse(first.get('manifest.json')!.toString('utf8')) as Record<string, unknown>
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        generatorVersion: 1,
        fileCount: firstSummary.fileCount,
        symbolCount: firstSummary.symbolCount,
        edgeCount: firstSummary.edgeCount,
        testCount: firstSummary.testCount,
      })
      for (const field of [
        'sourceTreeHash',
        'semanticHash',
        'configHash',
        'toolHash',
      ]) {
        expect(manifest[field]).toMatch(/^sha256:[a-f0-9]{64}$/)
      }
      expect(manifest).not.toHaveProperty('head')
      expect(manifest).not.toHaveProperty('generatedAt')

      const inventory = parseJsonLines(first.get('input-inventory.jsonl')!)
      const inventoryPaths = inventory.map((record) => String(record.path))
      expect(new Set(inventoryPaths).size).toBe(inventoryPaths.length)
      expect(new Set(inventory.map((record) => record.domain))).toEqual(
        new Set(['source', 'semantic', 'config', 'tool']),
      )
      expect(inventoryPaths.some((path) => path.startsWith('repo-index/generated/'))).toBe(false)
      expect(
        inventoryPaths.some((path) => path.startsWith('docs/development-plan/tasks/')),
      ).toBe(false)
      expect(inventoryPaths).not.toContain('docs/development-plan/TASK_BOARD.md')
      expect(
        inventory.find((record) => record.path === 'repo-index/config.json')?.domain,
      ).toBe('config')
      expect(
        inventory.find((record) => record.path === 'scripts/generate-repo-index.ts')?.domain,
      ).toBe('tool')

      const files = parseJsonLines(first.get('files.jsonl')!)
      for (const factName of ['files.jsonl', 'symbols.jsonl', 'edges.jsonl', 'tests.jsonl']) {
        for (const fact of parseJsonLines(first.get(factName)!)) {
          expect(fact).toMatchObject({
            schemaVersion: 1,
            origin: 'generated',
            statusClass: 'current-must-preserve',
          })
          expect(fact.evidence).toEqual(expect.any(Array))
        }
      }
      const shared = files.find((record) => record.path === 'src/shared/projectTypes.ts')
      expect(shared?.projects).toEqual([
        'tsconfig.e2e.json',
        'tsconfig.electron.json',
        'tsconfig.json',
      ])
      expect(parseJsonLines(first.get('symbols.jsonl')!).length).toBeGreaterThan(0)
      expect(parseJsonLines(first.get('edges.jsonl')!).length).toBeGreaterThan(0)
      expect(parseJsonLines(first.get('tests.jsonl')!).length).toBeGreaterThan(0)
      const edges = parseJsonLines(first.get('edges.jsonl')!)
      expect(edges).toContainEqual(expect.objectContaining({
        kind: 'imports_type',
        from: 'file:src/renderer/ui/Workspace.tsx',
        specifier: '../course/spatialEditorCommands',
        line: 121,
      }))
      expect(edges).toContainEqual(expect.objectContaining({
        kind: 'imports',
        from: 'file:src/renderer/preview/runtimePreviewDocument.ts',
        to: 'file:src/renderer/preview/runtimePreviewBootstrap.js',
        specifier: './runtimePreviewBootstrap.js?raw',
        resolved: true,
      }))
      expect(edges).toContainEqual(expect.objectContaining({
        kind: 'exports',
        from: 'file:scripts/repo-index/fixtures/adapter/src/index.ts',
        exportedName: 'renamedLocal',
        localName: 'localOnly',
      }))
      const symbols = parseJsonLines(first.get('symbols.jsonl')!)
      expect(symbols).toContainEqual(expect.objectContaining({
        file: 'scripts/repo-index/fixtures/adapter/src/index.ts',
        name: 'localOnly',
        exported: true,
        exportedAs: ['renamedLocal'],
      }))
      const tests = parseJsonLines(first.get('tests.jsonl')!)
      const parserFixture = tests.find(
        (record) => record.file === 'scripts/repo-index/fixtures/adapter/tests/index.test.ts',
      )
      expect(parserFixture).toMatchObject({
        runnable: false,
        diagnostic: expect.stringContaining('Parser fixture'),
      })
      expect(parserFixture).not.toHaveProperty('command')
      expect(
        tests.find((record) => record.file === 'tests/unit/repoIndexGenerator.test.ts'),
      ).toMatchObject({
        runnable: true,
        command: 'npx vitest run tests/unit/repoIndexGenerator.test.ts',
      })
      for (const [name, property] of [
        ['contracts.json', 'contracts'],
        ['scripts.json', 'packageScripts'],
        ['docs.json', 'documents'],
      ] as const) {
        expect(JSON.parse(first.get(name)!.toString('utf8'))).toMatchObject({
          schemaVersion: 1,
          origin: 'generated',
          statusClass: 'current-must-preserve',
          evidence: expect.any(Array),
          [property]: expect.any(Array),
        })
      }
    },
    30_000,
  )

  it(
    'checks through a temporary directory without touching committed generated files',
    () => {
      const generatedDirectory = resolve(temporaryRoot, 'check-expected')
      generateRepoIndexToDirectory(repoRoot, generatedDirectory)
      const beforeHash = hashGeneratedDirectory(generatedDirectory)
      const beforeTimes = modificationTimes(generatedDirectory)
      const result = checkRepoIndex(repoRoot, generatedDirectory)

      expect(result).toMatchObject({
        ok: true,
        difference: { missing: [], extra: [], changed: [] },
      })
      expect(hashGeneratedDirectory(generatedDirectory)).toBe(beforeHash)
      expect(modificationTimes(generatedDirectory)).toEqual(beforeTimes)
    },
    15_000,
  )
})

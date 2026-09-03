import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkPreservation,
  parsePreservationMap,
  PRESERVATION_PM_IDS,
} from '../../scripts/check-preservation'

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'preservation-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

function validFixtures() {
  return [
    {
      id: 'slide-heavy',
      path: 'fixtures/slide-heavy.h5lesson',
      identity: { kind: 'course-project-v9-archive', projectId: 'arch-0-slide-heavy' },
      generateCommand: 'node -e "process.exit(0)"',
      checkCommand: 'node -e "process.exit(0)"',
    },
  ]
}

function validRows(overrides: Record<string, unknown> = {}) {
  return PRESERVATION_PM_IDS.map((id) => {
    if (id === 'PM-01') {
      return {
        id,
        type: 'owner-observation',
        observer: 'Owner confirms desktop entries.',
        fixtureIds: ['slide-heavy'],
        inputClosure: ['src/app.ts'],
        invalidation: 'desktop shell changes',
      }
    }
    return {
      id,
      type: 'automated',
      evidenceCommand: 'node -e "process.exit(0)"',
      fixtureIds: ['slide-heavy'],
      inputClosure: ['tests/pm.ts'],
      invalidation: 'tests change',
      ...overrides,
    }
  })
}

async function writeProject(
  root: string,
  map: unknown,
  extraFiles: Record<string, string> = {},
): Promise<string> {
  const mapDir = path.join(root, 'docs', 'development-plan', 'baselines')
  await mkdir(mapDir, { recursive: true })
  await mkdir(path.join(root, 'fixtures'), { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await mkdir(path.join(root, 'tests'), { recursive: true })
  await mkdir(path.join(root, 'tests', 'unit'), { recursive: true })
  await mkdir(path.join(root, 'scripts'), { recursive: true })
  await mkdir(path.join(root, 'docs', 'development-plan', 'roadmap'), { recursive: true })
  await writeFile(path.join(root, 'fixtures', 'slide-heavy.h5lesson'), 'archive', 'utf8')
  await writeFile(path.join(root, 'src', 'app.ts'), 'export {}', 'utf8')
  await writeFile(path.join(root, 'tests', 'pm.ts'), 'export {}', 'utf8')
  await writeFile(path.join(root, 'package.json'), '{"scripts":{}}\n', 'utf8')
  await writeFile(path.join(root, 'scripts', 'check-preservation.ts'), 'export {}\n', 'utf8')
  await writeFile(path.join(root, 'tests', 'unit', 'preservationChecker.test.ts'), 'export {}\n', 'utf8')
  await writeFile(path.join(mapDir, 'V1_1_PRESERVATION_BASELINE.md'), '# baseline\n', 'utf8')
  await writeFile(
    path.join(root, 'docs', 'development-plan', 'roadmap', 'PRESERVATION_MATRIX.md'),
    '# matrix\n',
    'utf8',
  )
  const mapPath = path.join(mapDir, 'v1.1-preservation-map.json')
  await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
  for (const [relative, content] of Object.entries(extraFiles)) {
    const absolute = path.join(root, ...relative.split('/'))
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, content, 'utf8')
  }
  return mapPath
}

describe('1.1 preservation map', () => {
  it('parses the tracked 28-row map and keeps owner-observation unsigned', async () => {
    const repoRoot = path.join(fileURLToPath(import.meta.url), '../../..')
    const map = JSON.parse(
      readFileSync(path.join(repoRoot, 'docs/development-plan/baselines/v1.1-preservation-map.json'), 'utf8'),
    ) as unknown
    const parsed = parsePreservationMap(map)
    expect(parsed.rows).toHaveLength(28)
    expect(parsed.rows.map((row) => row.id)).toEqual([...PRESERVATION_PM_IDS])
    expect(parsed.rows.filter((row) => row.type === 'owner-observation').map((row) => row.id)).toEqual(['PM-01'])
  })
})

describe('preservation checker fixtures', () => {
  it('exits with missing-pm when a matrix row is absent', async () => {
    const root = await createTempRoot()
    const rows = validRows().filter((row) => row.id !== 'PM-03')
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows })
    await expect(checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })).rejects.toMatchObject({ category: 'missing-pm' })
  })

  it('exits with duplicate-pm when a PM is repeated', async () => {
    const root = await createTempRoot()
    const rows = validRows()
    rows.push({ ...rows[1]! })
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows })
    await expect(checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })).rejects.toMatchObject({ category: 'duplicate-pm' })
  })

  it('exits with malformed-map on unknown fields', async () => {
    const root = await createTempRoot()
    await writeProject(root, {
      schemaVersion: 1,
      release: '1.1',
      extra: true,
      fixtures: validFixtures(),
      rows: validRows(),
    })
    await expect(checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })).rejects.toMatchObject({ category: 'malformed-map' })
  })

  it('exits with stale-candidate when a previous report identity does not match', async () => {
    const root = await createTempRoot()
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows: validRows() })
    const previous = path.join(root, 'previous.json')
    await writeFile(previous, `${JSON.stringify({
      candidate: 'old',
      closureDigest: 'deadbeef',
      accepted: false,
    }, null, 2)}\n`, 'utf8')
    await expect(checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      previousReportPath: previous,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })).rejects.toMatchObject({ category: 'stale-candidate' })
  })

  it('validates declared working-tree content while reporting related dirty files', async () => {
    const root = await createTempRoot()
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows: validRows() })
    const result = await checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => ['tests/pm.ts'] },
    })
    expect(result.relatedDirtyFiles).toEqual(['tests/pm.ts'])
  })

  it('exits with related-dirty in require-clean candidate mode', async () => {
    const root = await createTempRoot()
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows: validRows() })
    await expect(checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      requireClean: true,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => ['tests/pm.ts'] },
    })).rejects.toMatchObject({ category: 'related-dirty' })
  })

  it('invalidates a previous report when closure file content changes', async () => {
    const root = await createTempRoot()
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows: validRows() })
    const reportPath = path.join(root, 'artifacts', 'release-evidence', 'v1.1', 'abc', 'preservation.json')
    await checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      reportPath,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })
    await writeFile(path.join(root, 'tests', 'pm.ts'), 'export const changed = true\n', 'utf8')
    await expect(checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      previousReportPath: reportPath,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })).rejects.toMatchObject({ category: 'stale-candidate' })
  })

  it('exits with underlying-failure when an automated command fails', async () => {
    const root = await createTempRoot()
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows: validRows() })
    await expect(checkPreservation({
      projectRoot: root,
      executeAutomated: true,
      hooks: {
        readHead: () => 'abc',
        listDirtyFiles: () => [],
        runCommand: () => ({ status: 1, stdout: '', stderr: 'boom' }),
      },
    })).rejects.toMatchObject({ category: 'underlying-failure' })
  })

  it('rejects a report path outside the candidate evidence directory', async () => {
    const root = await createTempRoot()
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows: validRows() })
    await expect(checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      reportPath: path.join(root, 'preservation.json'),
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })).rejects.toMatchObject({ category: 'malformed-map' })
  })

  it('records validated report reuse provenance and leaves no temporary file', async () => {
    const root = await createTempRoot()
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows: validRows() })
    const reportPath = path.join(root, 'artifacts', 'release-evidence', 'v1.1', 'abc', 'preservation.json')
    await checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      reportPath,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })
    const result = await checkPreservation({
      projectRoot: root,
      executeAutomated: false,
      previousReportPath: reportPath,
      hooks: { readHead: () => 'abc', listDirtyFiles: () => [] },
    })
    expect(result.reusedFrom).toMatchObject({
      reportPath: 'artifacts/release-evidence/v1.1/abc/preservation.json',
      candidate: 'abc',
      candidateMatches: true,
      closureMatches: true,
    })
    const siblings = await import('node:fs/promises').then(({ readdir }) => readdir(path.dirname(reportPath)))
    expect(siblings).toEqual(['preservation.json'])
  })

  it('does not fail when owner-observation is unsigned, and does not call it accepted', async () => {
    const root = await createTempRoot()
    await writeProject(root, { schemaVersion: 1, release: '1.1', fixtures: validFixtures(), rows: validRows() })
    const reportPath = path.join(root, 'artifacts', 'release-evidence', 'v1.1', 'abc', 'preservation.json')
    const result = await checkPreservation({
      projectRoot: root,
      executeAutomated: true,
      reportPath,
      hooks: {
        readHead: () => 'abc',
        listDirtyFiles: () => [],
        runCommand: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      },
    })
    expect(result.ownerObservationRequired).toEqual(['PM-01'])
    expect(result.rows.find((row) => row.id === 'PM-01')?.status).toBe('owner-observation-required')
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      accepted: boolean
      status: string
    }
    expect(report.accepted).toBe(false)
    expect(report.status).toBe('engineering-candidate')
  })
})

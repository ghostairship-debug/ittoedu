import { _electron as electron, expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

test('one frozen task region drives real candidate preview and formal adoption without repeating coordinates', async () => {
  test.setTimeout(90_000)
  const root = path.resolve(__dirname, '../..'), base = path.join(root, 'output/architecture-remediation-20261019/current-execution/region-handoff')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'run-'))
  await build({ entryPoints: [path.join(__dirname, 'helpers/taskRegionHandoffMain20261019.ts')], outfile: path.join(directory, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [path.join(directory, 'main.cjs')], env: { ...env,
    TASK_REGION_FIXTURE_DIR: directory, TASK_REGION_FIXTURE_ROOT: root } })
  try {
    const facts = await app.evaluate(async () => Reflect.get(globalThis, 'runTaskRegionHandoff')())
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    expect(facts.geometry).toEqual({ viewport: { width: 640, height: 360 }, stage: { width: 640, height: 360 }, vw: { width: 320, height: 72 } })
    expect(facts.feedback).toBe('运行完成，反馈可见')
    expect(facts.source).toBe('isolated-html-preview')
    expect(facts.prepared).toEqual([{ width: 640, height: 360 }])
    expect(facts.measured).toEqual([{ width: 640, height: 360 }])
    expect(facts.formalFrame).toEqual(facts.region)
    expect(facts.reopenedFrame).toEqual(facts.region)
    expect(facts.receipt).toEqual({ frame: facts.region, viewport: { width: 640, height: 360 } })
    expect(facts.preservedHeading).toBe(true)
    expect(facts.undoDepth).toBe(1)
    expect(facts.undo).toBe('applied')
    expect(facts.undoPreservedHeading).toBe(true)
    expect(facts.windowsRestored).toBe(true)
  } finally { await app.close() }
  console.log(`Task region evidence: ${directory}`)
})

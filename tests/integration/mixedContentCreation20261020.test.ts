// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'

it('uses real project.apply measurement and canonical consumers for ordinary, local and global source boundaries', async () => {
  const base = path.resolve('output/creation-boundary-implementation-20261020/C/after')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'run-'))
  const main = path.join(directory, 'main.cjs')
  await build({ entryPoints: [path.resolve('tests/e2e/helpers/mixedContentMain20261020.ts')], outfile: main,
    bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  const env: NodeJS.ProcessEnv = { ...process.env, C_PROBE_DIR: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const require = createRequire(import.meta.url)
  let logs = ''
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(require('electron') as string, [main], { env, windowsHide: true })
    child.stdout.on('data', value => { logs += value })
    child.stderr.on('data', value => { logs += value })
    child.on('error', reject); child.on('exit', resolve)
  })
  const error = await readFile(path.join(directory, 'error.txt'), 'utf8').catch(() => '')
  expect(code, `${error}\n${logs}`).toBe(0)
  const facts = JSON.parse(await readFile(path.join(directory, 'facts.json'), 'utf8'))
  for (const value of Object.values(facts) as any[]) {
    expect(value.applied).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    expect(value.coldReopened).toBe(true)
  }
  const keys = (name: string) => facts[name].instances.map((instance: any) => instance.implementation?.key)
  expect(keys('ordinary')).toEqual(expect.arrayContaining(['guoling.text', 'guoling.image', 'guoling.interactions']))
  expect(keys('ordinary')).not.toContain('guoling.html-program')
  expect(facts.ordinary.next).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(facts.ordinary.edits.unresolved).toEqual({ undoRestored: true, neighborUnchanged: true })
  expect(facts.ordinary.edits.afterContent.id).toBe(facts.ordinary.edits.before.id)
  expect(facts.ordinary.edits.afterContent.frame).toEqual(facts.ordinary.edits.before.frame)
  for (const name of ['mixed', 'srcdoc']) {
    expect(keys(name)).toContain('guoling.text')
    expect(keys(name).filter((key: string) => key === 'guoling.html-program')).toHaveLength(1)
    expect(facts[name].runtime).toMatchObject({ output: '1', iframe: true, viewport: { width: 520, height: 200 } })
  }
  expect(facts.global.runtime).toMatchObject({ output: '1', title: 'Global 1', iframe: false })
  expect(keys('operations')).toEqual(expect.arrayContaining(['guoling.text', 'guoling.html-program']))
  expect(facts.operations).toMatchObject({ revision: 1, undoDepth: 1, runtime: { output: '1', iframe: false } })
  expect(facts.global.edits.afterContent).toMatchObject({ id: facts.global.edits.before.id, definitionId: facts.global.edits.before.definitionId, frame: facts.global.edits.before.frame })
  expect(facts.global.edits.redone).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  const redone = facts.global.edits.afterRedo
  expect(redone.definitions[redone.instance.definitionId].implementation.key).toBe('guoling.group')
  expect(redone.instance.childIds).toHaveLength(2)
  expect(redone.instance.frame).toEqual(facts.global.edits.before.frame)
  const stage = facts.stage.instances.find((instance: any) => instance.data?.html?.includes('data-gl-layout="stage"'))
  expect(stage?.implementation.key).toBe('guoling.web')
  expect(stage.data.html).toContain('data-gl-slot="actions"')
  expect(stage.children).toBeUndefined()
  expect(facts.stage.instances.filter((instance: any) => instance.implementation?.key === 'guoling.text')).toHaveLength(1)
  expect(keys('json')).not.toContain('guoling.html-program')
  expect(facts.json.instances.some((instance: any) => instance.data?.html?.includes('<script type="application/json">{"hello":"world"}</script>'))).toBe(true)
  expect(facts.json.runtime).toEqual({ hello: 'world' })
  expect(facts.headJson.runtime).toEqual({ name: 'Head data' })
  expect(keys('form')).not.toContain('guoling.html-program')
  expect(facts.form.instances.some((instance: any) => instance.data?.html?.includes('<form id="activity"'))).toBe(true)
  expect(facts.form.runtime).toEqual({ owner: 'activity', label: true, invalid: true, valid: true })
  expect(facts.css.runtime).toEqual({ before: 'none', after: 'block', text: 'Shared CSS feedback' })
  expect(facts.records.edits.afterContent.authoring.records.text).toMatchObject({ binding: { baseline: 'Changed baseline' }, overrides: { geometry: { translateX: 12 } } })
  expect(facts.records.edits.unresolved).toMatchObject({ sameRevision: true, receipt: { kind: 'read', data: { commit: 'unchanged', diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'redo-authoring-source-retained' })]) } } })
  expect(facts.records.edits.unresolved.instance.authoring).toEqual(facts.records.edits.afterContent.authoring)
}, 120_000)

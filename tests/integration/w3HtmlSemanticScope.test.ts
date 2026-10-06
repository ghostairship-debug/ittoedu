// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron, type Page } from '@playwright/test'
import { expect, it } from 'vitest'

it('retains radio/label/reset/state CSS in one real Web carrier and permits local content edit/Undo/save/reopen', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-w3-'))
  await fs.symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'junction')
  const evidence = process.env.GUOLING_W3_EVIDENCE || path.join(directory, 'evidence')
  await fs.mkdir(evidence, { recursive: true })
  const entry = path.join(directory, 'main.cjs')
  const baseline = process.env.GUOLING_W3_BASELINE
  const originalSources = ['src/core/contentApply/assembly/htmlAssembly.ts', 'src/main/workbench/contentApply/application/html.ts',
    ...['browserCapture.ts', 'prepareMeasurementDocument.ts', 'ElectronHtmlDesignMeasurement.ts'].map(name => `src/main/workbench/contentApply/measurement/${name}`)]
  await build({ entryPoints: [path.resolve('tests/fixtures/w3-html-semantics/main.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'sharp'], logLevel: 'silent',
    plugins: baseline ? [{ name: 'original-w3-source', setup(build) { build.onLoad({ filter: /\.ts$/ }, input => {
      const relative = path.relative(process.cwd(), input.path).replace(/\\/g, '/')
      return originalSources.includes(relative) ? { contents: execFileSync('git', ['show', `${baseline}:${relative}`], { encoding: 'utf8', windowsHide: true }), loader: 'ts' } : undefined
    }) } }] : [] })
  await build({ entryPoints: [path.resolve('tests/fixtures/w3-html-semantics/renderer.ts')], outfile: path.join(directory, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife', logLevel: 'silent' })
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script>window.fixtureErrors=[];window.onerror=(message,source,line,column,error)=>window.fixtureErrors.push(String(error?.stack||message));</script><script src="renderer.js"></script></body></html>')
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => name !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const application = await electron.launch({ args: [entry], cwd: process.cwd(), env: { ...env, NODE_PATH: path.resolve('node_modules'), GUOLING_W3_DIRECTORY: directory }, timeout: 30000 })
  const raw: any[] = []
  let page: Page | undefined, stderr = ''
  application.process().stderr?.on('data', chunk => { stderr += chunk.toString() })
  try {
    await application.evaluate(async () => {
      for (let i = 0; i < 200 && !(globalThis as any).w3Fixture; i++) await new Promise(resolve => setTimeout(resolve, 20))
      if (!(globalThis as any).w3Fixture) throw new Error((globalThis as any).w3FixtureError || 'Fixture startup failed')
    })
    page = await application.firstWindow()
    raw.push({ phase: 'renderer-startup', url: page.url(), errors: await page.evaluate(() => (window as any).fixtureErrors) })
    const html = await fs.readFile('tests/fixtures/w3-html-semantics/form.html', 'utf8')
    const bareWindow = application.waitForEvent('window')
    await application.evaluate(async (_electron, html) => (globalThis as any).w3Fixture.bare(html), html)
    const bare = await bareWindow
    const bareGeometry = await bare.locator('form').evaluate(form => ({ width: form.getBoundingClientRect().width, height: form.getBoundingClientRect().height }))
    await bare.screenshot({ path: path.join(evidence, 'bare-initial.png') })
    await bare.locator('label[for="pg4rOn"]').click()
    raw.push({ phase: 'bare-click', geometry: bareGeometry, state: await bare.evaluate(() => ({ on: (document.querySelector('#pg4rOn') as HTMLInputElement).checked, off: (document.querySelector('#pg4rOff') as HTMLInputElement).checked, display: getComputedStyle(document.querySelector('.answer')!).display })) })
    await bare.screenshot({ path: path.join(evidence, 'bare-revealed.png') })
    await bare.close()
    const imported: any = await application.evaluate(async (_electron, html) => (globalThis as any).w3Fixture.insert(html), html)
    raw.push({ phase: 'import', ...imported })
    expect(imported.result).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    expect(await page.evaluate(model => (window as any).renderW3(model), imported.model)).toEqual([])
    const reveal = async (phase: string) => {
      const frames = page!.frames().filter(frame => frame !== page!.mainFrame())
      const labelFrame = (await Promise.all(frames.map(async frame => await frame.locator('label[for="pg4rOn"]').count() ? frame : undefined))).find(Boolean)!
      const before = await labelFrame.locator('label[for="pg4rOn"]').evaluate((label: HTMLLabelElement) => ({ control: label.control?.id ?? null, form: (label.control as HTMLInputElement | null)?.form?.id ?? null }))
      await labelFrame.locator('label[for="pg4rOn"]').click()
      const after = await labelFrame.evaluate(() => ({ on: (document.querySelector('#pg4rOn') as HTMLInputElement)?.checked,
        off: (document.querySelector('#pg4rOff') as HTMLInputElement)?.checked, display: document.querySelector('.answer') ? getComputedStyle(document.querySelector('.answer')!).display : null }))
      raw.push({ phase, before, after, frames: frames.length,
        controls: await Promise.all(frames.map(frame => frame.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('#pg4rOn,#pg4rOff')].map(input => ({ id: input.id, checked: input.checked, form: input.form?.id ?? null }))))) })
      await page!.screenshot({ path: path.join(evidence, `${phase}-revealed.png`) })
      expect(before).toEqual({ control: 'pg4rOn', form: 'lesson' })
      expect(after).toEqual({ on: true, off: false, display: 'block' })
      await labelFrame.locator('button[type="reset"]').click()
      const reset = await labelFrame.evaluate(() => ({ on: (document.querySelector('#pg4rOn') as HTMLInputElement).checked,
        off: (document.querySelector('#pg4rOff') as HTMLInputElement).checked, display: getComputedStyle(document.querySelector('.answer')!).display }))
      raw.push({ phase: `${phase}-reset`, reset }); expect(reset).toEqual({ on: false, off: true, display: 'none' })
    }
    await reveal('initial-click')
    const actualGeometry = await Promise.all(page.frames().filter(frame => frame !== page!.mainFrame()).map(async frame => frame.locator('#lesson').count().then(async count => count ? frame.locator('#lesson').evaluate(form => ({ width: form.getBoundingClientRect().width, height: form.getBoundingClientRect().height })) : undefined)))
    raw.push({ phase: 'bare-vs-carrier-box', bare: bareGeometry, carrier: actualGeometry.find(Boolean),
      frames: await Promise.all(page.frames().filter(frame => frame !== page!.mainFrame()).map(frame => frame.evaluate(() => ({ width: innerWidth, height: innerHeight, body: document.body.getBoundingClientRect().toJSON(), form: document.querySelector('form')?.getBoundingClientRect().toJSON() })))),
      boxes: await page.evaluate(() => [...document.querySelectorAll('iframe,[data-w3-instance]')].map(node => ({ tag: node.localName, id: (node as HTMLElement).dataset.w3Instance, style: (node as HTMLElement).style.cssText, rect: node.getBoundingClientRect().toJSON(), parent: node.parentElement?.localName }))) })
    expect(actualGeometry.find(Boolean)).toEqual(bareGeometry)
    const project = imported.model.project
    const semantic = Object.values(project.instances).find((value: any) => value.data?.html?.includes('id="pg4rOn"')) as any
    expect(semantic.childIds ?? []).toEqual([])
    const kinds = Object.values(project.instances).map((value: any) => project.definitions[value.definitionId].implementation.key)
    expect(kinds.filter(value => value === 'guoling.text').length).toBeGreaterThanOrEqual(2)
    const frame = semantic.frame, children = project.surfaces[0].childIds
    const edited: any = await application.evaluate(async (_electron, input) => (globalThis as any).w3Fixture.edit(input.id, input.html), { id: semantic.id, html: semantic.data.html.replace('总电压为 6 V', '总电压为 9 V') })
    raw.push({ phase: 'local-edit', ...edited }); expect(edited.result).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    expect(edited.model.project.instances[semantic.id].frame).toEqual(frame)
    expect(edited.model.project.surfaces[0].childIds).toEqual(children)
    expect(edited.model.project.instances[semantic.id].data.html).toContain('总电压为 9 V')
    const undone: any = await application.evaluate(async () => (globalThis as any).w3Fixture.undo())
    raw.push({ phase: 'undo', ...undone }); expect(undone.result.status).toBe('applied')
    expect(undone.model.project.instances[semantic.id].data).toEqual(semantic.data)
    raw.push({ phase: 'save', result: await application.evaluate(async () => (globalThis as any).w3Fixture.save()) })
    const reopened: any = await application.evaluate(async () => (globalThis as any).w3Fixture.reopen())
    raw.push({ phase: 'cold-host-open', ...reopened }); expect(reopened.dirty).toBe(false)
    const freshWindow = application.waitForEvent('window')
    await application.evaluate(async () => (globalThis as any).w3Fixture.freshWindow())
    page = await freshWindow
    await page.waitForLoadState()
    expect(await page.evaluate(model => (window as any).renderW3(model), reopened.model)).toEqual([])
    await reveal('reopened-click')
    for (const [phase, variant] of [['natural-flow', html.replace('height:180px;', '')], ['external-form-owner', await fs.readFile('tests/fixtures/w3-html-semantics/external-form.html', 'utf8')]] as const) {
      await application.evaluate(async () => (globalThis as any).w3Fixture.newCourse())
      const imported: any = await application.evaluate(async (_electron, html) => (globalThis as any).w3Fixture.insert(html), variant)
      raw.push({ phase: `${phase}-import`, ...imported })
      expect(imported.result).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
      if (phase === 'natural-flow') {
        expect(imported.assembly.root.kind).toBe('web')
        expect(imported.assembly.root.retainedSource.html).toBe(variant)
        expect(imported.assembly.root.retainedSource.reason).toContain('state-layout')
      }
      const freshWindow = application.waitForEvent('window')
      await application.evaluate(async () => (globalThis as any).w3Fixture.freshWindow())
      page = await freshWindow; await page.waitForLoadState()
      expect(await page.evaluate(model => (window as any).renderW3(model), imported.model)).toEqual([])
      await reveal(phase)
    }
  } finally {
    await fs.writeFile(path.join(evidence, 'raw.json'), JSON.stringify({ raw, stderr, directory }, null, 2))
    if (page) await page.screenshot({ path: path.join(evidence, 'carrier.png') }).catch(() => {})
    await application.close()
  }
}, 60000)

// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import { _electron as electron } from '@playwright/test'
import { expect, it } from 'vitest'

it('preserves an authored SVG rectangle and R1 label through real public insert and Web paint', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-w3-svg-'))
  await fs.symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'junction')
  const evidence = process.env.GUOLING_W3_SVG_EVIDENCE || path.join(directory, 'evidence')
  await fs.mkdir(evidence, { recursive: true })
  const entry = path.join(directory, 'main.cjs')
  await build({ entryPoints: [path.resolve('tests/fixtures/w3-html-semantics/main.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'sharp'], logLevel: 'silent' })
  await build({ entryPoints: [path.resolve('tests/fixtures/w3-html-semantics/renderer.ts')], outfile: path.join(directory, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife', logLevel: 'silent' })
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="renderer.js"></script></body></html>')
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => name !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const application = await electron.launch({ args: [entry], cwd: process.cwd(), env: { ...env, GUOLING_W3_DIRECTORY: directory }, timeout: 30000 })
  const raw: any = { source: await fs.readFile('tests/fixtures/w3-html-semantics/svg.html', 'utf8') }
  let stderr = ''
  application.process().stderr?.on('data', chunk => { stderr += chunk.toString() })
  const painted = () => {
    const box = (id: string) => {
      const element = document.getElementById(id)! as unknown as SVGGraphicsElement
      const bbox = element.getBBox(), style = getComputedStyle(element)
      return { bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height }, rect: element.getBoundingClientRect().toJSON(), text: element.textContent,
        namespace: element.namespaceURI, style: element.getAttribute('style'), width: style.width, height: style.height, fill: style.fill, display: style.display }
    }
    return { rect: box('resistor'), label: box('resistor-label'), svg: document.querySelector('svg')!.getBoundingClientRect().toJSON() }
  }
  try {
    await application.evaluate(async () => {
      for (let i = 0; i < 200 && !(globalThis as any).w3Fixture; i++) await new Promise(resolve => setTimeout(resolve, 20))
      if (!(globalThis as any).w3Fixture) throw new Error((globalThis as any).w3FixtureError || 'Fixture startup failed')
    })
    const page = await application.firstWindow()
    const bareWindow = application.waitForEvent('window')
    await application.evaluate(async (_electron, html) => (globalThis as any).w3Fixture.bare(html), raw.source)
    const bare = await bareWindow
    raw.bare = await bare.evaluate(painted)
    await bare.screenshot({ path: path.join(evidence, 'bare.png') })
    await bare.close()
    raw.imported = await application.evaluate(async (_electron, html) => (globalThis as any).w3Fixture.insert(html), raw.source)
    expect(raw.imported.result).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    raw.runtimeErrors = await page.evaluate(model => (window as any).renderW3(model), raw.imported.model)
    const frame = (await Promise.all(page.frames().filter(value => value !== page.mainFrame()).map(async value => await value.locator('#resistor').count() ? value : undefined))).find(Boolean)!
    await frame.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
    raw.carrier = await frame.evaluate(painted)
    raw.carrierBoxes = await page.evaluate(() => [...document.querySelectorAll('iframe,[data-w3-instance]')].map(node => ({ tag: node.localName, style: (node as HTMLElement).style.cssText, rect: node.getBoundingClientRect().toJSON(), visibility: getComputedStyle(node).visibility, display: getComputedStyle(node).display, opacity: getComputedStyle(node).opacity })))
    await page.screenshot({ path: path.join(evidence, 'carrier.png') })
    const svgInstance: any = Object.values(raw.imported.model.project.instances).find((value: any) => value.data?.html?.includes('id="resistor"'))
    raw.authoredReadback = svgInstance.data.html
    const readbackWindow = application.waitForEvent('window')
    await application.evaluate(async (_electron, html) => (globalThis as any).w3Fixture.bare(html), raw.authoredReadback)
    const readback = await readbackWindow
    raw.readbackBare = await readback.evaluate(painted)
    await readback.screenshot({ path: path.join(evidence, 'readback-bare.png') })
    await readback.close()
    expect(raw.runtimeErrors).toEqual([])
    expect(raw.carrier.rect.bbox).toEqual(raw.bare.rect.bbox)
    expect(raw.carrier.label.bbox).toEqual(raw.bare.label.bbox)
    expect(raw.carrier.rect.fill).toEqual(raw.bare.rect.fill)
    expect(raw.carrier.label.fill).toEqual(raw.bare.label.fill)
    expect(raw.carrier.label.text).toBe('R1')
    expect(raw.carrier.label.display).not.toBe('none')
  } finally {
    await fs.writeFile(path.join(evidence, 'raw.json'), JSON.stringify({ ...raw, stderr, directory }, null, 2))
    await application.close()
  }
}, 30000)

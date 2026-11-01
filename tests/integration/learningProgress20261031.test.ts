// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type BrowserContext } from 'playwright'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let directory: string, html: string, url: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'guoling-progress-'))
  const bundle = (await build({ stdin: { contents: "export {ComponentProgressStore} from './src/player/components/runtime/ComponentProgressStore'", resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'Progress', platform: 'browser' })).outputFiles[0]!.text
  html = `<!doctype html><meta charset="utf-8"><title>离线进度消费者</title><script>${bundle.replace(/<\/script/gi, '<\\/script')};
    window.owner = new Progress.ComponentProgressStore(); window.ports = new Map();
    window.openProgress = id => { const controller = new AbortController(); const port = owner.port(id, controller.signal, () => true); ports.set(id, {port, controller}); return port; };
  </script><main>离线本设备进度</main>`
  const file = join(directory, 'learning.html'); await writeFile(file, html); url = pathToFileURL(file).href
}, 15_000)
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

async function open(profile: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(join(directory, profile), { headless: true })
  await context.setOffline(true)
  return context
}

it('restores meaningful state after file refresh and a full browser close/reopen while offline', async () => {
  let context = await open('reopen')
  try {
    let page = await context.newPage(); await page.goto(url)
    const saved = await page.evaluate(async () => {
      const port = (window as any).openProgress('deep-oasis-copy')
      const initial = await port.read('learner', 1)
      const written = await port.write('learner', 1, { scene: 'rescue', oxygen: 42, unlocked: ['dive', 'ecosystem'], result: { ventRatio: 0.35, valid: true } }, initial.revision)
      return { initial, written }
    })
    expect(saved.initial).toEqual({ status: 'empty', revision: null })
    await page.reload()
    const refreshed = await page.evaluate(() => (window as any).openProgress('deep-oasis-copy').read('learner', 1))
    expect(refreshed).toMatchObject({ status: 'ready', revision: saved.written.revision, value: { scene: 'rescue', oxygen: 42, result: { ventRatio: 0.35, valid: true } } })
    await context.close(); context = await open('reopen')
    page = await context.newPage(); await page.goto(url)
    expect(await page.evaluate(() => (window as any).openProgress('deep-oasis-copy').read('learner', 1))).toEqual(refreshed)
    expect(await page.evaluate(() => (window as any).openProgress('other-work').read('learner', 1))).toEqual({ status: 'empty', revision: null })
    const copy = join(directory, 'learning-copy.html'); await writeFile(copy, html); await page.goto(pathToFileURL(copy).href)
    expect(await page.evaluate(() => (window as any).openProgress('deep-oasis-copy').read('learner', 1))).toEqual({ status: 'empty', revision: null })
  } finally { await context.close() }
}, 45_000)

it('uses an actual cross-window transaction and a reset tombstone to reject stale late saves', async () => {
  const context = await open('concurrent')
  try {
    const first = await context.newPage(), second = await context.newPage()
    await Promise.all([first.goto(url), second.goto(url)])
    for (const page of [first, second]) await page.evaluate(async () => { (window as any).snapshot = await (window as any).openProgress('same-work').read('learner', 1) })
    const results = await Promise.all([first, second].map((page, index) => page.evaluate(async index => {
      try { return { status: 'saved', ...(await (window as any).ports.get('same-work').port.write('learner', 1, { scene: index }, (window as any).snapshot.revision)) } }
      catch (error) { return { status: 'rejected', code: (error as any).code } }
    }, index)))
    expect(results.filter(result => result.status === 'saved')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toEqual([{ status: 'rejected', code: 'progress-conflict' }])
    for (const page of [first, second]) await page.evaluate(async () => { (window as any).snapshot = await (window as any).ports.get('same-work').port.read('learner', 1) })
    const reset = await first.evaluate(() => (window as any).ports.get('same-work').port.clear('learner', 1, (window as any).snapshot.revision))
    expect(await second.evaluate(async () => {
      try { await (window as any).ports.get('same-work').port.write('learner', 1, { scene: 'old-game' }, (window as any).snapshot.revision); return 'incorrectly saved' }
      catch (error) { return (error as any).code }
    })).toBe('progress-conflict')
    await second.reload()
    expect(await second.evaluate(() => (window as any).openProgress('same-work').read('learner', 1))).toEqual({ status: 'empty', revision: reset.revision })
  } finally { await context.close() }
}, 30_000)

it('never treats read failure or an incompatible record as empty, and revokes old generations', async () => {
  const context = await open('failures')
  try {
    const page = await context.newPage(); await page.goto(url)
    const result = await page.evaluate(async () => {
      const w = window as any, errors: string[] = [], capture = async (run: () => Promise<unknown>) => {
        try { await run(); errors.push('incorrectly accepted') } catch (error) { errors.push((error as any).code ?? (error as any).name) }
      }
      const port = w.openProgress('safe-work')
      await capture(() => port.write('learner', 1, { default: true }, null))
      const initial = await port.read('learner', 1)
      await port.write('learner', 1, { unlocked: true }, initial.revision)
      const incompatible = await port.read('learner', 2)
      await capture(() => port.write('learner', 2, { default: true }, incompatible.revision))
      const original = await port.read('learner', 1)
      await capture(() => port.write('learner', 1, { bad: Infinity }, original.revision))
      const pending = port.write('learner', 1, { late: true }, original.revision)
      w.ports.get('safe-work').controller.abort()
      await capture(() => pending)
      const fresh = w.openProgress('safe-work')
      const preserved = await fresh.read('learner', 1)
      const failing = new w.Progress.ComponentProgressStore({ indexedDB: { open() { throw new DOMException('storage unavailable', 'SecurityError') } } })
        .port('safe-work', new AbortController().signal, () => true)
      await capture(() => failing.read('learner', 1))
      await capture(() => failing.write('learner', 1, { default: true }, null))
      return { errors, incompatible, preserved }
    })
    expect(result.errors).toEqual(['progress-not-restored', 'progress-incompatible', 'progress-invalid', 'progress-cancelled', 'progress-unavailable', 'progress-not-restored'])
    expect(result.incompatible).toMatchObject({ status: 'incompatible', schemaVersion: 1 })
    expect(result.preserved).toMatchObject({ status: 'ready', value: { unlocked: true } })
  } finally { await context.close() }
}, 30_000)

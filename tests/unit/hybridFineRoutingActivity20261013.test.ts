// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

it('pauses direct function timers and RAF without repeating initialization or losing remaining delay', async () => {
  const bundle = await build({ stdin: { contents: "export {createCompiledContentEnvironment} from './src/player/componentPlatform/compiledContentEnvironment'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'ActivityProbe', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<main id="root"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const observed = await page.evaluate(async () => {
      const runtime = (window as any).ActivityProbe, listeners = new Set<(value: any) => void>()
      let activity = { active: true, visible: true, playing: false }, alive = true
      const scope = { isActive: () => alive, signal: new AbortController().signal,
        events: { emit() {}, subscribe(name: string, listener: (value: any) => void) {
          if (name !== '__runtime.activity') return () => {}
          listeners.add(listener); listener(activity); return () => listeners.delete(listener)
        } } }
      const env = runtime.createCompiledContentEnvironment({ root: document.getElementById('root'), instance: { id: 'direct-activity' }, scope })
      const setActivity = (next: typeof activity) => { activity = next; for (const listener of listeners) listener(next) }
      const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))
      const counts = { initialized: 0, interval: 0, timeout: 0, raf: 0, cleared: 0, clearedRaf: 0, microtask: 0, asyncProgram: 0 }
      let intervalId = 0, clearedTimeout = 0, clearIntervalWhilePaused = 0, clearedRaf = 0
      const factory = (globals: any) => {
        counts.initialized++
        const output = globals.document.createElement('output'); output.textContent = '0'; env.root.append(output)
        intervalId = globals.setInterval(function (this: any, amount: number) {
          if (this !== globals.window) throw new Error('timer receiver changed')
          counts.interval += amount; output.textContent = String(counts.interval)
        }, 160, 1)
        globals.setTimeout(() => { counts.timeout++ }, 280)
        clearedTimeout = globals.setTimeout(() => { counts.cleared++ }, 90)
        clearIntervalWhilePaused = globals.setInterval(() => { counts.cleared++ }, 90)
        clearedRaf = globals.requestAnimationFrame(() => { counts.clearedRaf++ })
        const tick = () => { counts.raf++; globals.requestAnimationFrame(tick) }
        globals.requestAnimationFrame(tick)
        globals.queueMicrotask(() => { counts.microtask++ })
      }
      const prepared = { classicPrograms: [{ index: 0, kind: 'async', activate: () => { counts.asyncProgram++ } }], handlerFactories: [] }
      await env.initialize([factory], prepared)
      await env.initialize([factory], prepared)
      const node = env.root.querySelector('output'), initiallyPaused = { ...counts, ready: env.globals.document.readyState }
      env.globals.clearTimeout(clearedTimeout); env.globals.clearTimeout(clearIntervalWhilePaused); env.globals.cancelAnimationFrame(clearedRaf)
      await wait(60)
      const stillInitiallyPaused = { ...counts }
      setActivity({ active: true, visible: true, playing: true })
      await wait(40)
      setActivity({ active: true, visible: false, playing: true })
      const paused = { ...counts }
      // Passing the original ID through the paired clear API must cancel a suspended record.
      const suspendedTimeout = env.globals.setTimeout(() => { counts.cleared++ }, 15)
      const suspendedRaf = env.globals.requestAnimationFrame(() => { counts.clearedRaf++ })
      env.globals.clearInterval(suspendedTimeout); env.globals.cancelAnimationFrame(suspendedRaf)
      await wait(330)
      const unchanged = { ...counts }
      setActivity({ active: false, visible: true, playing: true })
      await wait(30)
      const stillInactive = { ...counts }
      setActivity({ active: true, visible: true, playing: true })
      await wait(60)
      const resumedBeforeDue = { ...counts }
      await wait(95)
      const resumedInterval = { ...counts }
      await wait(110)
      const resumedTimeout = { ...counts }
      await wait(100)
      const resumedPeriod = { ...counts }
      setActivity({ active: true, visible: true, playing: false })
      env.globals.clearTimeout(intervalId)
      const beforeClearedResume = { ...counts }
      setActivity({ active: true, visible: true, playing: true })
      await wait(185)
      const clearedInterval = { ...counts }
      const preserved = env.root.querySelector('output') === node && node.isConnected
      const activeListeners = listeners.size
      env.dispose(); alive = false
      const disposed = { ...counts }, remainingListeners = listeners.size
      setActivity({ active: true, visible: true, playing: true })
      await wait(180)
      return { initiallyPaused, stillInitiallyPaused, paused, unchanged, stillInactive, resumedBeforeDue, resumedInterval, resumedTimeout, resumedPeriod, beforeClearedResume, clearedInterval, disposed, afterDispose: { ...counts }, preserved, activeListeners, remainingListeners, rootConnected: env.root.isConnected }
    })
    const evidenceDir = resolve('output/repair-fine-routing-20261013/direct-activity')
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(resolve(evidenceDir, 'actual.json'), JSON.stringify({ observed, errors }, null, 2))
    expect(observed.initiallyPaused).toEqual({ initialized: 1, interval: 0, timeout: 0, raf: 0, cleared: 0, clearedRaf: 0, microtask: 1, asyncProgram: 1, ready: 'complete' })
    expect(observed.stillInitiallyPaused).toEqual({ ...observed.initiallyPaused, ready: undefined })
    expect(observed.paused.raf).toBeGreaterThan(0)
    expect(observed.unchanged).toEqual(observed.paused)
    expect(observed.stillInactive).toEqual(observed.paused)
    expect(observed.resumedBeforeDue.interval).toBe(0); expect(observed.resumedBeforeDue.timeout).toBe(0)
    expect(observed.resumedBeforeDue.raf).toBeGreaterThan(observed.paused.raf)
    expect(observed.resumedInterval.interval).toBe(1); expect(observed.resumedInterval.timeout).toBe(0)
    expect(observed.resumedTimeout.timeout).toBe(1)
    expect(observed.resumedPeriod.interval).toBe(2)
    expect(observed.clearedInterval.interval).toBe(observed.beforeClearedResume.interval)
    expect(observed.clearedInterval.cleared).toBe(0); expect(observed.clearedInterval.clearedRaf).toBe(0)
    expect(observed.afterDispose).toEqual(observed.disposed)
    expect(observed).toMatchObject({ preserved: true, activeListeners: 1, remainingListeners: 0, rootConnected: false })
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 30000)

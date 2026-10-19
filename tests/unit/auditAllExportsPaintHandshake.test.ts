// @vitest-environment node
import { expect, it } from 'vitest'
import { chromium, type Frame } from '@playwright/test'
import type { WebFrameMain } from 'electron'
import { captureFramePaintInRealm, waitForCaptureFramePaint } from '../../src/main/workbench/observation/captureFramePaint'

it('capture paint waits visible opaque frames and skips hidden ancestors, including open shadow iframe trees', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="visible"></div><div id="hidden"></div>')
    await page.evaluate(() => {
      for (const id of ['visible', 'hidden']) {
        const shadow = document.getElementById(id)!.attachShadow({ mode: 'open' }), frame = document.createElement('iframe')
        frame.sandbox.add('allow-scripts')
        frame.srcdoc = `<p>${id}</p>` + (id === 'hidden' ? '<iframe sandbox="allow-scripts" srcdoc="<p>hidden-nested</p>"></iframe>' : '')
        shadow.append(frame)
      }
    })
    await page.waitForFunction(() => [...document.querySelectorAll('div')].every(host => host.shadowRoot?.querySelector('iframe')?.contentWindow))
    const frames = page.frames()
    expect(frames).toHaveLength(4)
    await page.evaluate(() => { document.getElementById('hidden')!.hidden = true })
    for (const frame of frames) {
      await frame.evaluate(() => {
        const native = requestAnimationFrame.bind(window)
        window.requestAnimationFrame = callback => {
          document.documentElement.dataset.paintCalls = String(Number(document.documentElement.dataset.paintCalls ?? '0') + 1)
          return native(callback)
        }
      })
    }
    const token = 'one-capture', script = (action: string) => `(${captureFramePaintInRealm.toString()})(${JSON.stringify(token)},${JSON.stringify(action)})`
    await Promise.all(frames.map(frame => frame.evaluate(script('install'))))
    await page.evaluate(() => {
      const child = document.getElementById('hidden')!.shadowRoot!.querySelector('iframe')!.contentWindow!
      child.postMessage({ type: 'guoling.capture.paint', token: 'wrong-capture', visible: true }, '*')
    })
    const hidden = frames.find(frame => frame !== page.mainFrame() && frame.childFrames().length === 1)!
    await hidden.evaluate(() => window.postMessage({ type: 'guoling.capture.paint', token: 'one-capture', visible: true }, '*'))
    await page.mainFrame().evaluate(script('start'))
    try { await Promise.all(frames.map(frame => frame.evaluate(script('wait')))) }
    finally { await Promise.all(frames.map(frame => frame.evaluate(script('dispose')))) }
    for (const frame of frames) {
      const value = await frame.evaluate(() => ({ text: document.body.textContent ?? '', width: innerWidth, height: innerHeight,
        paintCalls: Number(document.documentElement.dataset.paintCalls ?? '0'), temporary: Object.getOwnPropertyNames(window).filter(key => key.startsWith('__guoling_capture_paint_')) }))
      expect(value.temporary).toEqual([])
      if (value.text.includes('hidden')) { expect(value.width).toBeGreaterThan(0); expect(value.height).toBeGreaterThan(0); expect(value.paintCalls).toBe(0) }
      else expect(value.paintCalls).toBe(2)
    }
  } finally { await browser.close() }
}, 10_000)

it('paints nested child surfaces before the containing frame takes its final paint turns', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<iframe srcdoc="<p>Child surface</p>"></iframe>')
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.body.textContent?.includes('Child surface'))
    const child = page.frames().find(frame => frame !== page.mainFrame())!
    await child.setContent('<p>Child surface</p><iframe srcdoc="<p>Nested surface</p>"></iframe>')
    await child.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.body.textContent?.includes('Nested surface'))
    const frames = page.frames()
    for (const frame of frames) await frame.evaluate(() => {
      const original = requestAnimationFrame.bind(window)
      const state = window as Window & { paintTurns?: number; sampledUnpaintedChild?: boolean }
      state.paintTurns = 0; state.sampledUnpaintedChild = false
      window.requestAnimationFrame = callback => original(time => {
        state.paintTurns!++
        for (const child of document.querySelectorAll('iframe')) {
          if ((child.contentWindow as typeof state).paintTurns! < 2) state.sampledUnpaintedChild = true
        }
        callback(time)
      })
    })
    const adapters = new Map<Frame, WebFrameMain>()
    for (const frame of frames) adapters.set(frame, {
      detached: false,
      executeJavaScript: (script: string) => frame.evaluate(script),
      get parent() { return frame.parentFrame() ? adapters.get(frame.parentFrame()!) : null },
    } as unknown as WebFrameMain)
    const main = adapters.get(page.mainFrame())!
    await waitForCaptureFramePaint(main, 'child-before-parent', [...adapters.values()])
    for (const frame of frames) expect(await frame.evaluate(() => ({
      turns: (window as Window & { paintTurns?: number }).paintTurns,
      sampledUnpaintedChild: (window as Window & { sampledUnpaintedChild?: boolean }).sampledUnpaintedChild,
    }))).toEqual({ turns: 2, sampledUnpaintedChild: false })
  } finally { await browser.close() }
}, 10_000)

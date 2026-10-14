// @vitest-environment node
import { expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import { captureFramePaintInRealm } from '../../src/main/workbench/observation/captureFramePaint'

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

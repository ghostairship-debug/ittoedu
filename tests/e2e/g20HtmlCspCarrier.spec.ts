import { expect, test } from '@playwright/test'
import { createHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'

test('HTML carrier executes ordered scripts and handlers under inherited CSP', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' blob:; style-src 'unsafe-inline'">`)
  const source = createHtmlDocumentRuntimeSource({
    html: `<!doctype html><html><body><button id="action" onclick="this.textContent = event.type; window.order.push('click'); return false">Start</button><script>window.order = ['first']</script><script type="application/json" id="data">{"literal":"do not run"}</script><script>window.order.push('second')</script></body></html>`,
    resourceKeys: [],
  })
  const result = await page.evaluate(async source => {
    let definition: any
    new Function('CoursewareRuntime', source)({ define(value: unknown) { definition = value } })
    const root = document.body.appendChild(document.createElement('div'))
    let ready!: Promise<unknown>
    const lifecycle = definition.create({ dom: { root }, assets: { url() { throw Error('unexpected') } }, capture: { waitUntil(value: Promise<unknown>) { ready = value } } })
    await ready
    const frame = root.querySelector('iframe')!
    const child = frame.contentWindow as Window & { order: string[] }
    const button = frame.contentDocument!.getElementById('action') as HTMLButtonElement
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    const allowed = button.dispatchEvent(event)
    const value = { order: child.order, text: button.textContent, allowed, data: frame.contentDocument!.getElementById('data')?.textContent,
      scriptSources: Array.from(frame.contentDocument!.querySelectorAll('script')).map(script => script.getAttribute('src')) }
    lifecycle.destroy()
    return value
  }, source)
  expect(result.order).toEqual(['first', 'second', 'click'])
  expect(result.text).toBe('click')
  expect(result.allowed).toBe(false)
  expect(result.data).toBe('{"literal":"do not run"}')
  expect(result.scriptSources).toEqual([expect.stringMatching(/^blob:/), null, expect.stringMatching(/^blob:/)])
})

test('unsupported early event attributes fail and Blob scripts are revoked on destroy', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' blob:">`)
  const unsupported = createHtmlDocumentRuntimeSource({ html: '<body onload="window.ready=true"></body>', resourceKeys: [] })
  const supported = createHtmlDocumentRuntimeSource({ html: '<script>window.ready=true</script>', resourceKeys: [] })
  const result = await page.evaluate(({ unsupported, supported }) => {
    const define = (source: string) => {
      let definition: any
      new Function('CoursewareRuntime', source)({ define(value: unknown) { definition = value } })
      return definition
    }
    const root = document.body.appendChild(document.createElement('div'))
    let error = ''
    try { define(unsupported).create({ dom: { root }, assets: {}, capture: { waitUntil() {} } }) }
    catch (caught) { error = String(caught) }
    const revoked: string[] = []
    const original = URL.revokeObjectURL
    URL.revokeObjectURL = url => { revoked.push(url); original.call(URL, url) }
    try {
      const lifecycle = define(supported).create({ dom: { root }, assets: {}, capture: { waitUntil() {} } })
      lifecycle.destroy()
    } finally { URL.revokeObjectURL = original }
    return { error, revoked }
  }, { unsupported, supported })
  expect(result.error).toContain('不支持内联事件：onload')
  expect(result.revoked).toEqual([expect.stringMatching(/^blob:/)])
})

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
    const observed: string[] = []
    const observer = new MutationObserver(records => {
      for (const record of records) if (record.attributeName === 'data-html-document-ready') observed.push('ready')
    })
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-html-document-ready'] })
    let ready!: Promise<unknown>
    const lifecycle = definition.create({ dom: { root }, assets: { url() { throw Error('unexpected') } }, capture: { waitUntil(value: Promise<unknown>) { ready = value } } })
    await ready
    const frame = root.querySelector('iframe')!
    const readyAttribute = frame.dataset.htmlDocumentReady
    const child = frame.contentWindow as Window & { order: string[] }
    const button = frame.contentDocument!.getElementById('action') as HTMLButtonElement
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    const allowed = button.dispatchEvent(event)
    const value = { order: child.order, text: button.textContent, allowed, data: frame.contentDocument!.getElementById('data')?.textContent,
      readyAttribute, observed: [...observed],
      scriptSources: Array.from(frame.contentDocument!.querySelectorAll('script')).map(script => script.getAttribute('src')) }
    lifecycle.destroy()
    observer.disconnect()
    return { ...value, clearedOnDestroy: frame.dataset.htmlDocumentReady === undefined }
  }, source)
  expect(result.order).toEqual(['first', 'second', 'click'])
  expect(result.text).toBe('click')
  expect(result.allowed).toBe(false)
  expect(result.readyAttribute).toBe('true')
  expect(result.observed).toContain('ready')
  expect(result.clearedOnDestroy).toBe(true)
  expect(result.data).toBe('{"literal":"do not run"}')
  expect(result.scriptSources).toEqual([expect.stringMatching(/^blob:/), expect.stringMatching(/^blob:/), null,
    expect.stringMatching(/^blob:/), expect.stringMatching(/^blob:/), expect.stringMatching(/^blob:/)])
})

test('parser scripts preserve handler target, property override, and inline script order', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' blob:">`)
  const cases = [
    `<button id="target" onclick="this.textContent='clicked'">start</button><script>document.body.insertBefore(document.createElement('div'), document.body.firstChild)</script>`,
    `<button id="target" onclick="this.textContent='wrong'">start</button><script>document.getElementById('target').onclick=null</script>`,
    `<script>window.order=[]</script><button id="target" onclick="window.clicked=(window.clicked||0)+1">start</button><script>document.getElementById('target').onclick=null</script>`,
    `<script type="module">document.getElementById('target').onclick=null</script><button id="target" onclick="window.clicked=1">start</button>`,
    `<script defer>window.order=['first']</script><script async>window.order.push('second')</script><script>window.order.push('third')</script>`,
  ].map(html => createHtmlDocumentRuntimeSource({ html, resourceKeys: [] }))
  const result = await page.evaluate(async cases => {
    const output: Array<{ text?: string | null; order?: string[]; clicked?: number; attrs?: string[] }> = []
    for (const source of cases) {
      let definition: any
      new Function('CoursewareRuntime', source)({ define(value: unknown) { definition = value } })
      const root = document.body.appendChild(document.createElement('div'))
      let ready!: Promise<unknown>
      const lifecycle = definition.create({ dom: { root }, assets: {}, capture: { waitUntil(value: Promise<unknown>) { ready = value } } })
      await ready
      const frame = root.querySelector('iframe')!
      const button = frame.contentDocument!.getElementById('target')
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const child = frame.contentWindow as Window & { order?: string[]; clicked?: number }
      const order = child.order
      output.push({ text: button?.textContent, order, clicked: child.clicked, attrs: Array.from(frame.contentDocument!.querySelectorAll('script')).map(script =>
        `${script.hasAttribute('defer')}:${script.hasAttribute('async')}`) })
      lifecycle.destroy()
    }
    return output
  }, cases)
  expect(result[0]?.text).toBe('clicked')
  expect(result[1]?.text).toBe('start')
  expect(result[2]?.clicked).toBeUndefined()
  expect(result[3]?.clicked).toBeUndefined()
  expect(result[4]?.order).toEqual(['first', 'second', 'third'])
  expect(result[4]?.attrs).toEqual(['false:false', 'false:false', 'false:false'])
})

test('inline handlers resolve element, form, and document names', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' blob:">`)
  const source = createHtmlDocumentRuntimeSource({
    html: `<form><input name="answer" value="before"><button id="target" onclick="textContent='clicked'; answer.value='after'; documentElement.setAttribute('data-doc','changed')">Click</button></form>`,
    resourceKeys: [],
  })
  const result = await page.evaluate(async source => {
    let definition: any
    new Function('CoursewareRuntime', source)({ define(value: unknown) { definition = value } })
    const root = document.body.appendChild(document.createElement('div'))
    let ready!: Promise<unknown>
    const lifecycle = definition.create({ dom: { root }, assets: {}, capture: { waitUntil(value: Promise<unknown>) { ready = value } } })
    await ready
    const frame = root.querySelector('iframe')!
    const button = frame.contentDocument!.getElementById('target') as HTMLButtonElement
    button.click()
    const result = { text: button.textContent, answer: (frame.contentDocument!.querySelector('[name=answer]') as HTMLInputElement).value,
      documentValue: frame.contentDocument!.documentElement.getAttribute('data-doc') }
    lifecycle.destroy()
    return result
  }, source)
  expect(result).toEqual({ text: 'clicked', answer: 'after', documentValue: 'changed' })
})

test('early event attributes mount and fire, and Blob scripts are revoked on destroy', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' blob:">`)
  const source = createHtmlDocumentRuntimeSource({ html: '<body onload="window.ready=true"><script>window.scriptRan=true</script></body>', resourceKeys: [] })
  const result = await page.evaluate(async source => {
    const define = (source: string) => {
      let definition: any
      new Function('CoursewareRuntime', source)({ define(value: unknown) { definition = value } })
      return definition
    }
    const root = document.body.appendChild(document.createElement('div'))
    const revoked: string[] = []
    const original = URL.revokeObjectURL
    URL.revokeObjectURL = url => { revoked.push(url); original.call(URL, url) }
    try {
      let ready!: Promise<unknown>
      const lifecycle = define(source).create({ dom: { root }, assets: {}, capture: { waitUntil(value: Promise<unknown>) { ready = value } } })
      await ready
      const child = root.querySelector('iframe')!.contentWindow as Window & { ready?: boolean; scriptRan?: boolean }
      const fired = child.ready === true && child.scriptRan === true
      lifecycle.destroy()
      return { fired, revoked }
    } finally { URL.revokeObjectURL = original }
  }, source)
  expect(result.fired).toBe(true)
  expect(result.revoked.length).toBeGreaterThan(0)
  expect(result.revoked.every(url => url.startsWith('blob:'))).toBe(true)
})

// @vitest-environment node
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { htmlActionScript, type HtmlPageState } from '../../src/main/workbench/observation/HtmlActionPageScript'

it('observes and acts on viewport-propagated body overflow while retaining ordinary zero-height clipping', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
    await page.setContent(`<!doctype html><style>
      body { margin:0; overflow:hidden }
      #visible { position:absolute; left:30px; top:50px; width:100px; height:40px }
      #clipped { position:absolute; left:30px; top:130px; width:120px; height:0; overflow:hidden }
      #clipped button { width:100px; height:40px }
      </style><button id="visible">可见按钮</button><div id="clipped"><button>被裁剪按钮</button></div>`)
    expect(await page.locator('body').evaluate(body => body.getBoundingClientRect().height)).toBe(0)
    const observed = await page.evaluate(htmlActionScript({ type: 'observe' })) as HtmlPageState
    const button = observed.elements.find(element => element.text === '可见按钮')!
    expect(button).toBeDefined()
    expect(observed.elements.some(element => element.text === '被裁剪按钮')).toBe(false)
    expect(await page.evaluate(htmlActionScript({ type: 'click', path: button.path, fingerprint: button.fingerprint }))).toMatchObject({ applied: true })
    await page.locator('#visible').click()
    // A static body's box does not clip an absolute child whose containing block
    // is the viewport, even when html's overflow is hidden.
    await page.addStyleTag({ content: 'html { overflow:hidden }' })
    expect(await page.evaluate(() => document.elementFromPoint(60, 70)?.id)).toBe('visible')
    expect((await page.evaluate(htmlActionScript({ type: 'observe' })) as HtmlPageState).elements.some(element => element.text === '可见按钮')).toBe(true)
    // Once body itself is the containing block, its zero-height clip is real.
    await page.addStyleTag({ content: 'body { position:relative; height:0 }' })
    expect(await page.evaluate(() => document.elementFromPoint(60, 70)?.id)).not.toBe('visible')
    const clipped = await page.evaluate(htmlActionScript({ type: 'observe' })) as HtmlPageState
    expect(clipped.elements.some(element => element.text === '可见按钮')).toBe(false)
    // An inner containing block can itself belong to a viewport-positioned
    // subtree. The body's clip must not reappear at that inner boundary.
    await page.setContent(`<!doctype html><style>html{overflow:hidden}body{margin:0;overflow:hidden;height:0}
      #outer{position:absolute;left:0;top:0;width:200px;height:200px}
      #inner{position:relative;width:200px;height:200px}
      #target{position:absolute;left:30px;top:50px;width:100px;height:40px}</style>
      <div id="outer"><div id="inner"><button id="target">Nested viewport button</button></div></div>`)
    expect(await page.evaluate(() => document.elementFromPoint(60, 70)?.id)).toBe('target')
    const nested = await page.evaluate(htmlActionScript({ type: 'observe' })) as HtmlPageState
    const target = nested.elements.find(element => element.text === 'Nested viewport button')!
    expect(target).toBeDefined()
    expect(await page.evaluate(htmlActionScript({ type: 'click', path: target.path, fingerprint: target.fingerprint }))).toMatchObject({ applied: true })
  } finally { await browser.close() }
})

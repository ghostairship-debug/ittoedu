// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { htmlActionScript, type HtmlPageActionResult, type HtmlPageElement, type HtmlPageState } from '../../src/main/workbench/observation/HtmlActionPageScript'

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) })
afterAll(async () => { await browser?.close() })
const observe = (page: Page) => page.evaluate(htmlActionScript({ type: 'observe' })) as Promise<HtmlPageState>
const prepare = (page: Page, element: HtmlPageElement, input?: string, requireFocus?: boolean) => page.evaluate(htmlActionScript(input === undefined
  ? { type: 'click', path: element.path, fingerprint: element.fingerprint }
  : { type: 'input', path: element.path, fingerprint: element.fingerprint, value: input, requireFocus })) as Promise<HtmlPageActionResult>

it('discovers nested open-shadow controls and feedback, then uses their host-captured path for genuine input', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  try {
    await page.setContent('<!doctype html><body><p>Outer content</p><div id="host"></div>')
    await page.evaluate(() => {
      const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' })
      shadow.innerHTML = '<style>:host{display:block}button{width:140px;height:40px}</style><p>Shadow description</p><div id="nested"></div>'
      const inner = shadow.querySelector('#nested')!.attachShadow({ mode: 'open' })
      inner.innerHTML = '<button>Reveal clue</button><output></output><input aria-label="Shadow answer">'
      inner.querySelector('button')!.addEventListener('click', event => { inner.querySelector('output')!.textContent = event.isTrusted ? 'Clue revealed' : 'UNTRUSTED' })
    })
    const initial = await observe(page)
    expect(initial.structure).toEqual(['Outer content', 'Shadow description', 'Reveal clue'])
    const button = initial.elements.find(element => element.label === 'Reveal clue')!
    expect(button.path.filter(step => step === -1)).toHaveLength(2)
    const action = await prepare(page, button)
    expect(action.applied).toBe(true)
    await page.mouse.click(action.point!.x, action.point!.y)
    const result = await observe(page)
    expect(result.structure).toContain('Clue revealed')
    expect(result.structure).not.toContain('UNTRUSTED')
    const answer = result.elements.find(element => element.label === 'Shadow answer')!
    const input = await prepare(page, answer, '42')
    expect(input.applied).toBe(true)
    await page.mouse.click(input.point!.x, input.point!.y)
    expect(await prepare(page, answer, '42', true)).toMatchObject({ applied: true })
    await page.keyboard.insertText('42')
    expect((await observe(page)).elements.find(element => element.label === 'Shadow answer')?.value).toBe('42')
    await page.evaluate(() => document.querySelector('#host')!.shadowRoot!.querySelector('#nested')!.shadowRoot!.querySelector('button')!.textContent = 'Changed clue')
    expect(await prepare(page, button)).toMatchObject({ applied: false, reason: 'stale-element' })
  } finally { await page.close() }
})

it('inherits host clipping and visibility, and refuses a shadow control covered in the outer document', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  try {
    await page.setContent('<!doctype html><body style="margin:0"><div id="host" style="position:relative;width:160px;height:70px;overflow:hidden"></div><div id="hidden" style="opacity:0"></div>')
    await page.evaluate(() => {
      document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<button style="position:absolute;left:0;top:0;width:100px;height:30px">Visible choice</button><button style="position:absolute;top:100px">Clipped choice</button>'
      document.querySelector('#hidden')!.attachShadow({ mode: 'open' }).innerHTML = '<button>Hidden choice</button>'
    })
    const state = await observe(page)
    expect(state.elements.filter(element => element.tag === 'button').map(element => element.label)).toEqual(['Visible choice'])
    expect(state.structure).toEqual(['Visible choice'])
    const choice = state.elements.find(element => element.label === 'Visible choice')!
    await page.evaluate(() => { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:100;background:white'; document.body.append(cover) })
    expect(await prepare(page, choice)).toMatchObject({ applied: false, reason: 'covered-element' })
    expect(await page.evaluate(htmlActionScript({ type: 'click', path: [-2], fingerprint: choice.fingerprint }))).toMatchObject({ applied: false, reason: 'stale-element' })
  } finally { await page.close() }
})

// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { build } from 'esbuild'
import path from 'node:path'

let browser: Browser, script: string
beforeAll(async () => {
  script = (await build({ entryPoints: [path.resolve('src/shared/flowBilateralLayout.ts')], bundle: true,
    format: 'iife', globalName: 'bilateral', write: false, platform: 'browser' })).outputFiles[0].text
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })
const styles = `<style>body{margin:0} .text-root{width:760px;position:relative;font:24px/1.4 Arial;min-height:1800px}
  .central-object{position:relative;width:33%;max-width:33%;float:left;clear:both;margin:8px -66.5% 8px 33.5%;box-sizing:border-box;z-index:1;--flow-bilateral:1;background:#def}
  p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere} img{display:block;width:100%}</style>`
async function metrics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#root')!, object = document.querySelector<HTMLElement>('#object')!, box = object.getBoundingClientRect()
    let left = 0, right = 0, overlap = 0
    for (const p of root.querySelectorAll('p')) {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) for (let i = 0; i < n.length; i++) {
        if (!n.data[i].trim()) continue
        const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + 1)
        const r = range.getBoundingClientRect()
        if (r.bottom <= box.top + .25 || r.top >= box.bottom - .25) continue
        if (r.right <= box.left) left++
        else if (r.left >= box.right) right++
        else overlap++
      }
    }
    const words = [...root.querySelectorAll<HTMLElement>('[data-word]')].map(word => {
      const walker = document.createTreeWalker(word, NodeFilter.SHOW_ALL)
      let at = 0, internalGaps = 0, textNodes = 0
      const tops: number[] = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n instanceof HTMLElement && n.hasAttribute('data-flow-bilateral-gap') && at > 0 && at < word.textContent!.length) internalGaps++
        if (n instanceof Text && n.length) {
          textNodes++; at += n.length
          const range = document.createRange(); range.selectNodeContents(n)
          tops.push(...[...range.getClientRects()].map(r => r.top))
        }
      }
      return { text: word.textContent, internalGaps, textNodes, rowSpread: Math.max(...tops) - Math.min(...tops) }
    })
    return { left, right, overlap, words, gaps: root.querySelectorAll('[data-flow-bilateral-gap]').length,
      gapsEmpty: [...root.querySelectorAll('[data-flow-bilateral-gap]')].every(gap => gap.textContent === ''),
      text: [...root.querySelectorAll('p')].map(p => p.textContent), height: box.height, rootHeight: root.getBoundingClientRect().height,
      identity: (window as any).sentinel === root.querySelector('#sentinel')?.firstChild
        && (window as any).strong === root.querySelector('strong') && (window as any).em === root.querySelector('em') }
  })
}

it('retains logical words across marks and old view-only Text splits through repeated narrow/wide layout', async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  try {
    await page.setContent(styles + `<main id="root" class="text-root"><figure id="object" class="central-object" data-compiled-node="object" style="height:300px;--flow-bilateral:1"></figure>
      <p>${'A '.repeat(14)}<span data-word>inter<strong>oper</strong><em>ability</em></span> ${'regular prose '.repeat(12)}</p>
      <p>${'A '.repeat(7)}<span data-word>electroencephalographically</span> ${'continued prose '.repeat(30)}</p><p id="sentinel">Preserved tail text identity.</p></main>`)
    await page.addScriptTag({ content: script })
    const baseline = await page.evaluate(() => {
      ;(window as any).sentinel = document.querySelector('#sentinel')!.firstChild
      ;(window as any).strong = document.querySelector('strong'); (window as any).em = document.querySelector('em')
      return [...document.querySelectorAll('#root p')].map(p => p.textContent)
    })
    for (const width of [760, 1200, 760, 1200]) {
      await page.evaluate(width => {
        const root = document.querySelector<HTMLElement>('#root')!; root.style.width = width + 'px'
        const api = (window as any).bilateral
        api.applyFlowBilateralDomGaps(root, api.planFlowBilateralGaps(root, [...root.querySelectorAll('p')]))
      }, width)
      const m = await metrics(page)
      expect(m.text).toEqual(baseline); expect(m.gapsEmpty).toBe(true); expect(m.identity).toBe(true)
      expect(m.overlap).toBe(0); expect(m.left).toBeGreaterThan(0); expect(m.right).toBeGreaterThan(0)
      if (width === 760) expect(m.words[1].textNodes).toBeGreaterThan(1)
      else for (const word of m.words) { expect(word.internalGaps).toBe(0); expect(word.rowSpread).toBeLessThan(.5) }
    }
  } finally { await page.close() }
}, 20000)

it('observes an initially zero-height central object and replans after only its intrinsic image size changes', async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('https://flow.test/delayed.svg', async route => {
    await held
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="330" height="180"><rect width="330" height="180" fill="skyblue"/></svg>' })
  })
  try {
    await page.setContent(styles + `<main id="root" class="text-root"><figure id="object" class="central-object" data-compiled-node="object" style="--flow-bilateral:1"><img src="https://flow.test/delayed.svg"></figure><p>${'正文需要围绕中央对象并保持自然的文字阅读次序。'.repeat(24)}</p></main>`, { waitUntil: 'domcontentloaded' })
    await page.addScriptTag({ content: script })
    await page.evaluate(() => {
      const state = (window as any).probe = { observed: false, notices: [] as string[], mutations: 0, applies: [] as any[], errors: [] as string[], released: false, observer: undefined as undefined | { destroy(): void } }
      const original = window.ResizeObserver
      window.ResizeObserver = class extends original {
        constructor(callback: ResizeObserverCallback) { super((entries, observer) => { if (state.released) state.notices.push(...entries.map(e => (e.target as HTMLElement).id)); callback(entries, observer) }) }
        observe(target: Element, options?: ResizeObserverOptions) { if (target.id === 'object') state.observed = true; super.observe(target, options) }
      }
      const root = document.querySelector<HTMLElement>('#root')!
      new MutationObserver(entries => { if (state.released) state.mutations += entries.length }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] })
      const api = (window as any).bilateral
      state.observer = api.observeFlowBilateralLayout(root, { textRoots: () => [...root.querySelectorAll('p')],
        apply: (gaps: any[]) => { state.applies.push({ gaps: gaps.length, mutations: state.mutations, notices: [...state.notices], released: state.released }); api.applyFlowBilateralDomGaps(root, gaps) }, error: (message: string) => state.errors.push(message) })
    })
    await page.waitForFunction(() => (window as any).probe.observed && (window as any).probe.applies.length > 0)
    const before = await metrics(page); expect(before.height).toBe(0); expect(before.gaps).toBe(0)
    await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); (window as any).probe.released = true })
    release()
    await page.waitForFunction(() => (window as any).probe.applies.some((a: any) => a.released && a.gaps > 0), undefined, { timeout: 5000 })
    const after = await metrics(page), evidence = await page.evaluate(() => {
      const p = (window as any).probe; return { first: p.applies.find((a: any) => a.released && a.gaps > 0), errors: p.errors }
    })
    expect(after.height).toBeGreaterThan(1); expect(after.rootHeight).toBe(before.rootHeight)
    expect(after.overlap).toBe(0); expect(after.left).toBeGreaterThan(0); expect(after.right).toBeGreaterThan(0)
    expect(evidence.first.mutations).toBe(0); expect(evidence.first.notices).toContain('object'); expect(evidence.errors).toEqual([])
  } finally { release(); await page.evaluate(() => (window as any).probe?.observer.destroy()).catch(() => {}); await page.close() }
}, 20000)

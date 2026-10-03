// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('observation waits for finite page, shadow and frame animations, never for endless or over-long ones', async () => {
  const bundle = (await build({
    stdin: { contents: `export {waitForPublishedAnimationsSettled} from './src/player/surfaces/publishedCapture';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'AnimationSettle',
  })).outputFiles[0]!.text
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    await page.setContent(`<style>
      @keyframes enter { from { opacity: 0 } to { opacity: 1 } }
      @keyframes spin { to { transform: rotate(360deg) } }
      .enter.go { animation: enter 400ms 200ms both }
      .spin { animation: spin 1s linear infinite }
      .slow.go { animation: enter 3s both }
    </style>
    <div id="page"><p class="enter">标题</p><i class="spin">●</i><span id="script">脚本</span></div>
    <div id="component"><div id="shadow"></div></div>
    <div id="runtime"><iframe id="frame" srcdoc="<style>@keyframes enter{from{opacity:0}to{opacity:1}}p.go{animation:enter 500ms both}</style><p>框内</p>"></iframe></div>
    <div id="other"><p class="slow">很慢</p></div>`)
    await page.waitForFunction(() => (document.getElementById('frame') as HTMLIFrameElement).contentDocument?.readyState === 'complete')
    await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async () => {
      const api = (window as unknown as { AnimationSettle: { waitForPublishedAnimationsSettled(root: HTMLElement, options?: { maxWaitMs?: number }): Promise<void> } }).AnimationSettle
      const settle = async (id: string, start: () => void, maxWaitMs?: number) => {
        start()
        const started = performance.now()
        await api.waitForPublishedAnimationsSettled(document.getElementById(id)!, maxWaitMs === undefined ? {} : { maxWaitMs })
        return performance.now() - started
      }
      const state = (element: Element) => element.getAnimations()[0]?.playState

      const pageElapsed = await settle('page', () => {
        document.querySelector('.enter')!.classList.add('go')
        // An entrance a script starts on the next frame is created after the wait began.
        requestAnimationFrame(() => document.getElementById('script')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'both' }))
      })
      const pageStates = { enter: state(document.querySelector('.enter')!), script: state(document.getElementById('script')!), spin: state(document.querySelector('.spin')!) }

      const shadowRoot = document.getElementById('shadow')!.attachShadow({ mode: 'open' })
      await settle('component', () => {
        shadowRoot.innerHTML = '<style>@keyframes enter{from{opacity:0}to{opacity:1}}b{animation:enter 500ms both}</style><b>组件</b>'
      })
      const frameParagraph = (document.getElementById('frame') as HTMLIFrameElement).contentDocument!.querySelector('p')!
      await settle('runtime', () => frameParagraph.classList.add('go'))

      const slow = document.querySelector('.slow')!
      const cappedElapsed = await settle('other', () => slow.classList.add('go'), 300)
      return { pageElapsed, pageStates, shadow: state(shadowRoot.querySelector('b')!), frame: state(frameParagraph), cappedElapsed, slow: state(slow) }
    })
    expect(result).toMatchObject({
      pageStates: { enter: 'finished', script: 'finished', spin: 'running' },
      shadow: 'finished', frame: 'finished', slow: 'running',
    })
    // The endless spinner would otherwise hold the wait until its five-second bound.
    expect(result.pageElapsed).toBeLessThan(3_000)
    expect(result.cappedElapsed).toBeLessThan(1_500)
  } finally {
    await browser.close()
  }
}, 30_000)

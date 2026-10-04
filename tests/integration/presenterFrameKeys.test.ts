// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('course keys typed inside page, component and Runtime frames reach the course unless the frame keeps them', async () => {
  const bundle = (await build({
    stdin: { contents: `export {PlayerPresenterInput} from './src/player/PlayerPresenterInput';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CourseKeys',
  })).outputFiles[0]!.text
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    const frameDocument = `<p id="text" tabindex="0">页面文字</p><input id="answer"><div id="game" tabindex="0">小游戏</div>
      <div style="height:3000px"></div>
      <script>
        document.getElementById('game').addEventListener('keydown', event => { if (event.key === 'ArrowLeft') event.preventDefault() })
        window.addEventListener('keydown', event => setTimeout(() => { window.lastPrevented = event.defaultPrevented }))
      </script>`
    await page.setContent(`<div id="stage">
        <button id="stage-button">舞台按钮</button>
        <iframe id="page" srcdoc="${frameDocument.replace(/"/g, '&quot;')}"></iframe>
        <div id="component"></div>
      </div>
      <iframe id="elsewhere" srcdoc="<p id='other' tabindex='0'>编辑器其他区域</p>"></iframe>`)
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(frame => frame.contentDocument?.readyState === 'complete'))
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async () => {
      const component = document.getElementById('component')!.attachShadow({ mode: 'open' })
      component.innerHTML = '<iframe id="runtime" srcdoc="<p id=\'runtime-text\' tabindex=\'0\'>整页程序</p>"></iframe>'
      const runtime = component.getElementById('runtime') as HTMLIFrameElement
      await new Promise<void>(resolve => runtime.addEventListener('load', () => resolve(), { once: true }))
      const commands: unknown[] = []
      Object.assign(window, { commands })
      const api = (window as unknown as { CourseKeys: { PlayerPresenterInput: new (options: unknown) => unknown } }).CourseKeys
      new api.PlayerPresenterInput({
        root: document.getElementById('stage'),
        keyboardNavigation: true,
        presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
        navigate: (command: unknown) => { commands.push(command); return true },
        onAuthoredCommand: () => true,
        dedupeMs: 0,
      })
    })
    const commands = () => page.evaluate(() => (window as unknown as { commands: unknown[] }).commands.splice(0))
    const frame = page.frameLocator('#page')

    await page.click('#stage-button')
    await page.keyboard.press('PageDown')
    expect(await commands()).toEqual([{ kind: 'step', direction: 'next' }])

    await frame.locator('#text').click()
    await expect.poll(async () => {
      await page.keyboard.press('ArrowRight')
      return commands()
    }).toEqual([{ kind: 'step', direction: 'next' }])
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('End')
    expect(await commands()).toEqual([{ kind: 'scene', direction: 'previous' }, { kind: 'edge', edge: 'last' }])
    // The course key does not also scroll the frame.
    expect(await frame.locator('body').evaluate(() => [(window as unknown as { lastPrevented: boolean }).lastPrevented, window.scrollY]))
      .toEqual([true, 0])

    await frame.locator('#game').click()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    expect(await commands()).toEqual([{ kind: 'step', direction: 'next' }])
    // A listener the frame adds later still decides before the course.
    await frame.locator('#game').evaluate(element => element.ownerDocument.defaultView!.addEventListener('keydown', event => {
      if (event.key === 'Home') event.preventDefault()
    }))
    await page.keyboard.press('Home')
    expect(await commands()).toEqual([])

    await frame.locator('#answer').click()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Home')
    expect(await commands()).toEqual([])

    await page.locator('#component iframe').contentFrame().locator('#runtime-text').click()
    await expect.poll(async () => {
      await page.keyboard.press('ArrowLeft')
      return commands()
    }).toEqual([{ kind: 'step', direction: 'previous' }])

    await page.frameLocator('#elsewhere').locator('#other').click()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('PageDown')
    expect(await commands()).toEqual([])
  } finally {
    await browser.close()
  }
}, 60_000)

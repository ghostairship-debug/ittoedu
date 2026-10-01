import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { chooseM23Workspace, closeM23, launchM23, openM23Html } from './helpers/g20M23Harness'

function silentWav(): string {
  const wav = Buffer.alloc(44 + 16000)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(16000, 40)
  return wav.toString('base64')
}

test('UF09 hidden preview pauses controlled animation/media, retains state, and explicitly recovers its frame', async () => {
  test.setTimeout(150000)
  const f = m23Fixture('usability-preview-closeout')
  const source = `<!doctype html><html><head><style>@keyframes move{from{transform:translateX(0)}to{transform:translateX(100px)}}
    #motion{width:50px;height:50px;background:blue;animation:move 3s linear infinite}body{padding:30px}</style></head><body>
    <h1>Stateful preview</h1><input id="answer" aria-label="Answer"><button id="play">Play silent audio</button>
    <audio id="audio" muted loop src="data:audio/wav;base64,${silentWav()}"></audio><div id="motion"></div>
    <script>window.keepMe=42;document.querySelector('#play').onclick=()=>{window.wasClicked=true;document.querySelector('#audio').play().catch(error=>window.mediaFailure=String(error));};</script></body></html>`
  writeFileSync(join(f.workspace, 'stateful.html'), source)
  const { app, page } = await launchM23(f)
  const facts: Record<string, unknown> = {}
  try {
    await chooseM23Workspace(app, page, f.workspace)
    const region = await openM23Html(page, 'stateful.html'), preview = region.frameLocator('iframe')
    await preview.getByLabel('Answer').fill('teacher draft stays')
    facts.button = await preview.locator('#play').evaluate(button => ({ html: button.outerHTML, handler: (button as HTMLButtonElement).onclick?.toString() }))
    await preview.getByRole('button', { name: 'Play silent audio' }).press('Enter')
    facts.mediaBefore = await preview.locator('#audio').evaluate(element => { const audio = element as HTMLAudioElement; const win = audio.ownerDocument.defaultView!; return { paused: audio.paused, ready: audio.readyState, error: audio.error?.message, mediaFailure: Reflect.get(win, 'mediaFailure'), clicked: Reflect.get(win, 'wasClicked'), keep: Reflect.get(win, 'keepMe'), source: audio.currentSrc.slice(0, 120), animations: audio.ownerDocument.getAnimations().map(a => a.playState) } })
    console.log('MEDIA_DIAGNOSTIC', facts.mediaBefore)
    await expect.poll(() => preview.locator('#audio').evaluate(audio => !(audio as HTMLAudioElement).paused)).toBe(true)
    const currentFrame = await (await region.locator('iframe').elementHandle())!.contentFrame()
    if (!currentFrame) throw new Error('Missing real preview frame')
    // The hidden region leaves the accessibility tree, not the DOM. Read the same frame rather than a visible role locator.
    const state = () => currentFrame.locator('body').evaluate(body => ({ value: (body.querySelector('#answer') as HTMLInputElement).value,
      keep: Reflect.get(body.ownerDocument.defaultView!, 'keepMe'), audioPaused: (body.querySelector('#audio') as HTMLAudioElement).paused,
      animations: body.ownerDocument.getAnimations().map(animation => animation.playState) }))
    await openM23Html(page, 'sibling.html')
    await expect.poll(async () => (await state()).audioPaused).toBe(true)
    await expect.poll(async () => (await state()).animations.every(value => value === 'paused')).toBe(true)
    facts.hidden = await state()
    expect(facts.hidden).toMatchObject({ value: 'teacher draft stays', keep: 42 })
    await page.getByRole('tab', { name: /^stateful\.html/ }).click()
    await expect.poll(async () => (await state()).animations.every(value => value === 'running')).toBe(true)
    expect(await state()).toMatchObject({ value: 'teacher draft stays', keep: 42 })
    // Lose only this fixture's frame content; the production reload control must rebuild the same source.
    await region.locator('iframe').evaluate(frame => { (frame as HTMLIFrameElement).src = 'about:blank' })
    await region.getByRole('button', { name: '重新加载预览', exact: true }).click()
    await expect(preview.getByRole('heading', { name: 'Stateful preview' })).toBeVisible()
    expect(readFileSync(join(f.workspace, 'stateful.html'), 'utf8')).toBe(source)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(680, 560))
    const save = region.getByRole('button', { name: '保存', exact: true })
    await expect(save).toBeVisible()
    const saveHit = await save.evaluate(button => { const r = button.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === button } })
    expect(saveHit.right).toBeLessThanOrEqual(saveHit.width); expect(saveHit.bottom).toBeLessThanOrEqual(saveHit.height); expect(saveHit.hit).toBe(true)
    facts.narrowWindowSave = saveHit
    await save.click()
    facts.reloadedAndSaved = true
    await page.screenshot({ path: join(f.directory, 'preview-small-window.png') })
  } finally { writeFileSync(join(f.directory, 'closeout-evidence.json'), JSON.stringify(facts, null, 2)); await closeM23(app) }
})

test('UF04 actual window offers a cancellable recovery exit when the renderer never acknowledges', async () => {
  test.setTimeout(150000)
  const f = m23Fixture('usability-window-closeout'), original = f.sources.lightEdit
  let current: Awaited<ReturnType<typeof launchM23>> | undefined
  const facts: Record<string, unknown> = {}
  try {
    current = await launchM23(f); const { app, page } = current
    await chooseM23Workspace(app, page, f.workspace)
    const region = await openM23Html(page, 'light-edit.html')
    await region.getByRole('toolbar', { name: 'HTML 视图', exact: true }).getByRole('button', { name: '源码', exact: true }).click()
    const changed = original.replace('可编辑 HTML 课例', 'Confirmed recoverable draft')
    await region.getByLabel('纯文本编辑', { exact: true }).fill(changed)
    await expect.poll(() => page.evaluate(async () => (await window.desktopAPI.documents!.list())
      .find(doc => doc.binding.kind === 'file' && doc.binding.path.endsWith('light-edit.html'))?.dirty)).toBe(true)
    await app.evaluate(({ BrowserWindow, dialog }, channel) => {
      const main = BrowserWindow.getAllWindows()[0]!, send = main.webContents.send.bind(main.webContents)
      main.webContents.send = ((name: string, ...args: unknown[]) => { if (name !== channel) send(name, ...args) }) as typeof send
      Reflect.set(globalThis, 'closeoutCloseChoice', 0); Reflect.set(globalThis, 'closeoutDialogs', [])
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.at(-1) as { title: string; buttons?: string[] }
        Reflect.get(globalThis, 'closeoutDialogs').push(options)
        return { response: Reflect.get(globalThis, 'closeoutCloseChoice'), checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      main.close()
    }, IPC_CHANNELS.requestPreserveAndClose)
    await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, 'closeoutDialogs').length)).toBe(1)
    expect(page.isClosed()).toBe(false)
    expect(readFileSync(f.files.lightEdit, 'utf8')).toBe(original)
    facts.returnedToEditor = true
    const closed = page.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => { Reflect.set(globalThis, 'closeoutCloseChoice', 2); BrowserWindow.getAllWindows()[0]!.close() })
    await closed
    await app.close().catch(() => undefined); current = undefined
    current = await launchM23(f)
    await expect(current.page.getByRole('button', { name: '新建会话', exact: true })).toBeVisible()
    const restored = await current.page.evaluate(async () => window.desktopAPI.documents!.recoverable())
    expect(restored.some(doc => doc.model.kind === 'text' && doc.model.source === changed)).toBe(true)
    expect(readFileSync(f.files.lightEdit, 'utf8')).toBe(original)
    facts.recoveredAfterRestart = true
  } finally { writeFileSync(join(f.directory, 'closeout-evidence.json'), JSON.stringify(facts, null, 2)); if (current) await closeM23(current.app) }
})

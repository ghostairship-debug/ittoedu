import { expect, test, type ElectronApplication } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { closeSelectionApp, launchSelectionApp } from './helpers/g20SelectionHarness'

const digest = (filename: string) => createHash('sha256').update(readFileSync(filename)).digest('hex')
type RainFrameState = { url: string; parentPostMessage: string; ownerAvailable: boolean; ranges: Array<{ value: string; label: string | null }>; q?: string; h?: string; text: string }

test('current rainfall export exposes its real parent-facade slider through the formal HTML action owner', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Real current Windows export consumer')
  test.setTimeout(120_000)
  const source = resolve('output/goal-correction-20261102/creation-rain/builtin-r2/workspace/雨水去哪儿了.html')
  const base = resolve('output/goal-correction-20261102/acp-html-facade-regression')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), copy = join(directory, '雨水去哪儿了.html')
  const sourceBefore = digest(source)
  copyFileSync(source, copy)
  expect(digest(copy)).toBe(sourceBefore)
  let app: ElectronApplication | undefined
  try {
    app = await launchSelectionApp(directory)
    await app.firstWindow()
    const facts = await app.evaluate(async ({ app, BrowserWindow }, input) => {
      const requireProduct = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`)
      const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
      const initial = await host.internalAPI.open(input.filename)
      const runId = input.runId
      await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [], selection: [{ kind: 'document' }] }],
        fileAccess: { permission: 'workspace', workspaceRoot: input.directory } })
      const call = async (name: string, args: Record<string, unknown>) => {
        const value = await host.tools.execute(runId, `${name}-${process.getBuiltinModule('node:crypto').randomUUID()}`, { name, input: args })
        if (value.kind !== 'read' || !value.data) throw new Error(`${name} failed: ${JSON.stringify(value)}`)
        return value.data as any
      }
      const readFrame = async () => {
        const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed())
        const frames = windows.flatMap(window => window.webContents.mainFrame.framesInSubtree)
        const candidates = await Promise.all(frames.map(async frame => ({ frame, state: await frame.executeJavaScript(`(() => ({
          url:location.href, parentPostMessage:typeof window.parent.postMessage, ownerAvailable:!!window.frameElement,
          ranges:Array.from(document.querySelectorAll('input[type=range]')).map(input=>({value:input.value,label:input.getAttribute('aria-label')})),
          q:document.querySelector('#q')?.textContent?.trim(), h:document.querySelector('#h')?.textContent?.trim(),
          text:document.body?.innerText ?? '' }))()`).then(value => value as RainFrameState).catch(() => null) })))
        const matching = candidates.filter(item => item.state?.url === 'about:srcdoc' && item.state.ranges.length >= 2)
        if (matching.length !== 1) throw new Error(`Expected one real interactive srcdoc, found ${matching.length}`)
        return matching[0]!.state!
      }
      try {
        await call('html.observe', {})
        const page3 = await call('html.navigate', { index: 2 })
        if (page3.pageIndex !== 2) throw new Error(`Navigation did not reach page 3: ${JSON.stringify(page3.pageIndex)}`)
        const before = await readFrame()
        const rain = page3.elements.find((element: { tag: string; label: string; handle?: string }) => element.tag === 'input' && element.label === '降雨量 P，单位毫米')
        if (!rain?.handle) throw new Error(`Page 3 observation lacks rainfall slider: ${JSON.stringify(page3.observationScope)}`)
        const adjusted = await call('html.input', { handle: rain.handle, value: '0' })
        const zero = await readFrame()
        const reset = adjusted.elements.find((element: { tag: string; label: string; handle?: string }) => element.tag === 'button' && element.label === '重置探索')
        if (!reset?.handle) throw new Error('Fresh post-input observation lacks the reset button')
        const restored = await call('html.click', { handle: reset.handle })
        const afterReset = await readFrame()
        const document = await host.internalAPI.read(initial.documentId)
        return { before, zero, afterReset, pageIndex: page3.pageIndex, scope: page3.observationScope,
          rain: { label: rain.label, value: rain.value }, adjustedReceipt: adjusted.actionReceipt, resetReceipt: restored.actionReceipt,
          finalDocument: { revision: document.revision, dirty: document.dirty, undoDepth: document.undoDepth } }
      } finally { await host.tools.stop(runId) }
    }, { filename: copy, directory, runId: randomUUID() })
    await info.attach('Formal HTML action facts', { body: JSON.stringify({ sourceBefore, ...facts }, null, 2), contentType: 'application/json' })
    expect(facts.pageIndex).toBe(2)
    expect(facts.before.parentPostMessage).toBe('undefined')
    expect(facts.before.ownerAvailable).toBe(true)
    expect(facts.rain).toMatchObject({ label: '降雨量 P，单位毫米', value: '30' })
    expect([facts.before.q, facts.before.h]).toEqual(['18.6', '27'])
    expect(facts.zero.ranges[0].value).toBe('0')
    expect([facts.zero.q, facts.zero.h]).toEqual(['0', '0'])
    expect(facts.zero.text).not.toBe(facts.before.text)
    expect(facts.afterReset.ranges.map((range: { value: string }) => range.value)).toEqual(facts.before.ranges.map((range: { value: string }) => range.value))
    expect([facts.afterReset.q, facts.afterReset.h]).toEqual(['18.6', '27'])
    expect(facts.afterReset.text).toBe(facts.before.text)
    expect(facts.finalDocument).toMatchObject({ revision: 0, dirty: false, undoDepth: 0 })
    expect(digest(copy)).toBe(sourceBefore)
    expect(digest(source)).toBe(sourceBefore)
  } finally { if (app) await closeSelectionApp(app) }
})

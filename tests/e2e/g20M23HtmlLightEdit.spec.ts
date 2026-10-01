import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { m23Fixture, m23ReplacementPng } from './helpers/g20M23Fixtures'
import { chooseM23Workspace, closeM23, launchM23, m23Editor, m23ReadDocument, m23Shot, m23Snapshot, openM23Html, writeM23Evidence } from './helpers/g20M23Harness'

async function currentSource(page: import('@playwright/test').Page, documentId: string) {
  const snapshot = await m23ReadDocument(page, documentId)
  if (snapshot.model.kind !== 'text') throw new Error('Expected the open HTML document to remain a canonical text document')
  return snapshot.model.source
}

async function nativeHistory(app: import('@playwright/test').ElectronApplication, direction: 'undo' | 'redo') {
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    if (!window.isVisible()) window.show()
    window.focus()
  })
  // Showing a background Electron window and sending a shortcut in the same
  // main-process turn can precede its focused-frame update. Wait for the real
  // preview focus, without retrying Ctrl+Z or bypassing the native input route.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focusedFrame?.url ?? ''))
    .toMatch(/^courseware-preview:/)
  await app.evaluate(({ BrowserWindow }, keyCode) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] })
  }, direction === 'undo' ? 'Z' : 'Y')
}

async function applyTextEdit(page: import('@playwright/test').Page, preview: import('@playwright/test').FrameLocator, selector: string, value: string) {
  await preview.locator(selector).dblclick()
  const dialog = page.getByRole('dialog', { name: '编辑 HTML 文字', exact: true })
  await expect(dialog).toBeVisible()
  const editor = dialog.getByLabel('HTML 文字', { exact: true })
  const before = await editor.inputValue()
  await editor.fill(value)
  const button = dialog.getByRole('button', { name: '应用', exact: true })
  await button.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(preview.locator(selector)).toHaveText(value)
  return before
}

test('M23-T03 preview text and image edits use document history, explicit save and reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M23 light-edit acceptance requires the Windows Electron host.')
  test.setTimeout(240_000)
  const fixture = m23Fixture('light-edit')
  const facts: Record<string, unknown> = { case: 'M23-T03', status: 'running', steps: [] }
  let app: Awaited<ReturnType<typeof launchM23>>['app'] | undefined
  let page: Awaited<ReturnType<typeof launchM23>>['page'] | undefined
  let capture: Awaited<ReturnType<typeof launchM23>>['capture'] | undefined
  let failure: unknown
  try {
    const launched = await launchM23(fixture); app = launched.app; page = launched.page; capture = launched.capture
    await chooseM23Workspace(app, page, fixture.workspace)
    let regionA = await openM23Html(page, 'light-edit.html')
    const viewA = regionA.frameLocator('iframe[title="HTML 预览"]')
    await regionA.getByRole('toolbar', { name: 'HTML 分页', exact: true }).getByRole('button', { name: '编辑预览', exact: true }).click()
    const openedA = await m23Snapshot(page, fixture.files.lightEdit)
    expect(openedA?.model.kind).toBe('text')
    const docA = openedA!.documentId
    const original = fixture.sources.lightEdit
    expect((openedA!.model as { kind: 'text'; source: string }).source).toBe(original)
    const regionStatus = regionA.getByRole('status')

    await viewA.locator('#count-up').click()
    await viewA.locator('#count-up').click()
    await expect(viewA.locator('#count-value')).toHaveText('计数：2')

    const duplicateText = '甲处已修改。'
    await applyTextEdit(page, viewA, '#duplicate-a', duplicateText)
    const afterDuplicate = original.replace('<p id="duplicate-a">同一文案。</p>', `<p id="duplicate-a">${duplicateText}</p>`)
    await expect(viewA.locator('#duplicate-b')).toHaveText('同一文案。')
    await expect.poll(() => currentSource(page!, docA)).toBe(afterDuplicate)
    expect(readFileSync(fixture.files.lightEdit, 'utf8')).toBe(original)
    await expect(regionStatus).toHaveText('未保存')
    await page.waitForTimeout(1_000)
    facts.delayedPersistence = { waitedMs: 1000, dirty: true, diskUnchanged: readFileSync(fixture.files.lightEdit, 'utf8') === original }
    expect(readFileSync(fixture.files.lightEdit, 'utf8')).toBe(original)

    const special = '<观察 & 修订> "保留引号"'
    await applyTextEdit(page, viewA, '#special', special)
    const encodedSpecial = '&lt;观察 &amp; 修订&gt; "保留引号"'
    const afterSpecial = afterDuplicate.replace('<p id="special">原始 &amp; 文本：春天</p>', `<p id="special">${encodedSpecial}</p>`)
    const specialSnapshot = await m23Snapshot(page, fixture.files.lightEdit)
    expect(specialSnapshot?.model.kind).toBe('text')
    expect((specialSnapshot!.model as { kind: 'text'; source: string }).source).toBe(afterSpecial)
    expect(afterSpecial.replace(`<p id="special">${encodedSpecial}</p>`, '<p id="special">原始 &amp; 文本：春天</p>'))
      .toBe(afterDuplicate)
    await expect(viewA.locator('#count-value')).toHaveText('计数：2')

    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, fixture.files.replacement)
    await viewA.locator('#responsive').click()
    const imageDialog = page!.getByRole('dialog', { name: '替换 HTML 图片', exact: true })
    await expect(imageDialog).toBeVisible()
    await imageDialog.getByRole('button', { name: '选择图片', exact: true }).press('Enter')
    await expect(imageDialog).toHaveCount(0)
    await expect.poll(() => currentSource(page!, docA)).not.toBe(afterSpecial)
    const afterImage = await currentSource(page!, docA)
    facts.sourceAfterImage = afterImage
    expect(afterImage).toContain('src="light-edit.assets/image-')
    expect(afterImage).not.toContain('old-source-small.png')
    expect(afterImage).not.toContain('old-source-large.png')
    expect(afterImage).not.toContain('old-image-2x.png')
    expect(afterImage).not.toContain('sizes="300px"')
    const assetsPath = join(fixture.workspace, 'light-edit.assets')
    const assetNames = readdirSync(assetsPath)
    expect(assetNames).toHaveLength(1)
    expect(readFileSync(join(assetsPath, assetNames[0]!))).toEqual(m23ReplacementPng)
    await expect(viewA.locator('#count-value')).toHaveText('计数：2')

    await viewA.locator('#script-generated').dblclick()
    const runtimeDialog = page!.getByRole('dialog', { name: '编辑 HTML 文字', exact: true })
    await expect(runtimeDialog.getByText('不能直接修改这个位置，可用 AI 修改 HTML 源码。', { exact: true })).toBeVisible()
    await expect(runtimeDialog.getByLabel('HTML 文字', { exact: true })).toHaveCount(0)
    await expect(runtimeDialog.getByRole('button', { name: '应用', exact: true })).toHaveCount(0)
    await runtimeDialog.getByRole('button', { name: '关闭', exact: true }).click()
    facts.scriptCreated = { disabled: true, visibleText: await viewA.locator('#script-generated').textContent() }

    // Undo and redo must update canonical source through DocumentSession without reloading this live page.
    await viewA.locator('#count-up').click()
    await nativeHistory(app, 'undo')
    await expect.poll(() => currentSource(page!, docA)).toBe(afterSpecial)
    await expect(viewA.locator('#count-value')).toHaveText('计数：3')
    await nativeHistory(app, 'undo')
    await expect.poll(() => currentSource(page!, docA)).toBe(afterDuplicate)
    await expect(viewA.locator('#count-value')).toHaveText('计数：3')
    await nativeHistory(app, 'undo')
    await expect.poll(() => currentSource(page!, docA)).toBe(original)
    await expect(viewA.locator('#count-value')).toHaveText('计数：3')
    await nativeHistory(app, 'redo')
    await expect.poll(() => currentSource(page!, docA)).toBe(afterDuplicate)
    await nativeHistory(app, 'redo')
    await expect.poll(() => currentSource(page!, docA)).toBe(afterSpecial)
    await nativeHistory(app, 'redo')
    await expect.poll(() => currentSource(page!, docA)).toBe(afterImage)
    await expect(viewA.locator('#count-value')).toHaveText('计数：3')
    facts.history = { undoRedoRestoredSource: true, counterAfterEditsAndHistory: await viewA.locator('#count-value').textContent() }
    await m23Shot(fixture, page, info, 'light-edits-before-save')

    await regionA.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(fixture.files.lightEdit, 'utf8')).toBe(afterImage)
    await expect(regionStatus).toHaveText('已保存')
    facts.saved = { path: fixture.files.lightEdit, sourceSha256: await page.evaluate(source => crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)).then(bytes =>
      Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')), afterImage), imageAssets: assetNames }

    // Edit two open HTML documents, then verify Main routes each trusted shortcut only to the focused preview URL.
    const finalA = '甲标签历史测试已编辑'
    await applyTextEdit(page, viewA, '#lesson-title', finalA)
    const expectedA = afterImage.replace('<h1 id="lesson-title">可编辑 HTML 课例</h1>', `<h1 id="lesson-title">${finalA}</h1>`)
    const regionB = await openM23Html(page, 'sibling.html')
    const viewB = regionB.frameLocator('iframe[title="HTML 预览"]')
    await regionB.getByRole('toolbar', { name: 'HTML 分页', exact: true }).getByRole('button', { name: '编辑预览', exact: true }).click()
    const openedB = await m23Snapshot(page, fixture.files.sibling)
    expect(openedB?.model.kind).toBe('text')
    const docB = openedB!.documentId
    const changedB = '乙标签历史测试已编辑'
    await applyTextEdit(page, viewB, '#sibling-copy', changedB)
    const expectedB = fixture.sources.sibling.replace('<p id="sibling-copy">乙文案。</p>', `<p id="sibling-copy">${changedB}</p>`)

    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^light-edit\.html/ }).click()
    await expect(regionA).toBeVisible()
    await viewA.locator('#lesson-title').click()
    await nativeHistory(app, 'undo')
    await expect.poll(() => currentSource(page!, docA)).toBe(afterImage)
    await expect.poll(() => currentSource(page!, docB)).toBe(expectedB)
    await nativeHistory(app, 'redo')
    await expect.poll(() => currentSource(page!, docA)).toBe(expectedA)
    await expect.poll(() => currentSource(page!, docB)).toBe(expectedB)
    facts.twoTabHistory = { focused: 'light-edit.html', afterUndoA: 'saved baseline', siblingUntouched: true,
      afterRedoA: finalA, siblingAfterRedo: changedB }

    await regionA.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(fixture.files.lightEdit, 'utf8')).toBe(expectedA)
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^sibling\.html/ }).click()
    await regionB.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(fixture.files.sibling, 'utf8')).toBe(expectedB)

    await page.getByRole('button', { name: '关闭 light-edit.html', exact: true }).click()
    await expect(regionA).toHaveCount(0)
    regionA = await openM23Html(page, 'light-edit.html')
    const reopenedA = await m23Snapshot(page, fixture.files.lightEdit)
    expect(reopenedA?.documentId).not.toBe(docA)
    expect(reopenedA?.model.kind).toBe('text')
    const reopenedSource = (reopenedA!.model as { kind: 'text'; source: string }).source
    expect(reopenedSource).toBe(expectedA)
    expect(reopenedSource).not.toMatch(/html-preview-agent|courseware-preview:\/\/|html-preview-hidden-page-/i)
    const reopenedPreview = regionA.frameLocator('iframe[title="HTML 预览"]')
    await expect(reopenedPreview.locator('#lesson-title')).toHaveText(finalA)
    await expect(reopenedPreview.locator('#duplicate-a')).toHaveText(duplicateText)
    await expect(reopenedPreview.locator('#duplicate-b')).toHaveText('同一文案。')
    await expect(reopenedPreview.locator('#count-value')).toHaveText('计数：0')
    await expect(reopenedPreview.locator('#responsive')).toHaveAttribute('src', /light-edit\.assets\/image-/)
    const persistedImageSrc = await reopenedPreview.locator('#responsive').getAttribute('src')
    expect(readFileSync(join(fixture.workspace, persistedImageSrc!))).toEqual(m23ReplacementPng)
    facts.reopen = { documentIdBefore: docA, documentIdAfter: reopenedA!.documentId, sourceExact: true,
      noPreviewProxyMaterial: true, imageSrc: persistedImageSrc, imageBytesMatch: true }
    facts.status = 'passed'
    expect(capture.pageErrors).toEqual([])
    await m23Shot(fixture, page, info, 'reopened-saved-html')
  } catch (error) {
    failure = error; facts.status = 'failed'; throw error
  } finally {
    if (app && page && capture) {
      await m23Shot(fixture, page, info, failure ? 'failure' : 'light-edit-result')
      const evidence = await writeM23Evidence(fixture, page, app, capture, facts, failure)
      await info.attach('M23-T03 evidence.json', { path: evidence, contentType: 'application/json' })
      await closeM23(app)
    }
  }
})

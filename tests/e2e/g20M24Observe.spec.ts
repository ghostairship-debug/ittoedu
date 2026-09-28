import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { G20_M24_MODELS, G20_M24_PAGES, startG20M24ModelServer, type G20M24ObservationRound } from './helpers/g20M24Model'
import { attachG20M24Evidence, captureG20M24EditorState, closeG20M24App, configureG20M24Roles,
  createG20M24Connection, createG20M24Fixture, editG20M24SelectedTitle, launchG20M24App,
  openG20M24Course, readG20M24Document, selectG20M24Object, selectG20M24Page, sendG20M24Task,
  chooseG20M24Workspace } from './helpers/g20M24Harness'

function comparableState(state: Awaited<ReturnType<typeof captureG20M24EditorState>>) {
  return { revision: state.revision, undoDepth: state.undoDepth, redoDepth: state.redoDepth,
    selectedPage: state.selectedPage, selectionToolbar: state.selectionToolbar, viewport: state.viewport }
}

function summarizeRequests(requests: Array<{ model?: string; messages?: Array<{ role?: string; content?: unknown; tool_call_id?: string }>; tools?: Array<{ function?: { name?: string } }> }>) {
  return requests.map(request => ({ model: request.model, roles: request.messages?.map(message => message.role),
    imageParts: request.messages?.reduce((count, message) => count + (Array.isArray(message.content)
      ? (message.content as Array<{ type?: string }>).filter(part => part.type === 'image_url').length : 0), 0),
    toolNames: request.tools?.map(tool => tool.function?.name),
    toolResults: request.messages?.filter(message => message.role === 'tool').map(message => message.tool_call_id) }))
}

async function expectFinished(page: import('@playwright/test').Page, id: string) {
  await expect(page.getByText(new RegExp(`${id} 已`))).toBeVisible({ timeout: 45_000 })
}

async function waitForRound(page: import('@playwright/test').Page, round: G20M24ObservationRound) {
  await expect.poll(() => round.error ?? round.held, { timeout: 45_000 }).toBe(true)
  if (round.error) throw new Error(round.error)
}

async function saveScreenshot(page: import('@playwright/test').Page, directory: string, name: string,
  info: import('@playwright/test').TestInfo) {
  const path = join(directory, `${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await info.attach(`M24 ${name}`, { path, contentType: 'image/png' })
  return path
}

test('M24-T03 real Electron observations send the correct captured page for supported, fallback and unknown-inherited vision', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M24-T03 requires the Windows Electron host.')
  test.setTimeout(360_000)
  const fixture = createG20M24Fixture()
  const model = await startG20M24ModelServer(fixture.directory)
  const facts: Record<string, unknown> = { case: 'M24-T03', status: 'running', evidenceDirectory: fixture.directory,
    coveredModes: ['same-conversation-model-vision-supported', 'separate-vision-model-fallback', 'same-conversation-model-vision-unknown-inherited'] }
  const rounds: G20M24ObservationRound[] = []
  let app: Awaited<ReturnType<typeof launchG20M24App>>['app'] | undefined
  let page: Awaited<ReturnType<typeof launchG20M24App>>['page'] | undefined
  let capture: Awaited<ReturnType<typeof launchG20M24App>>['capture'] | undefined
  let failure: unknown
  try {
    const launched = await launchG20M24App(fixture); app = launched.app; page = launched.page; capture = launched.capture
    const connectionId = await createG20M24Connection(page, model.endpoint)
    await configureG20M24Roles(page, connectionId, G20_M24_MODELS.direct, G20_M24_MODELS.direct, true)
    await chooseG20M24Workspace(app, page, fixture.workspace)
    const opened = await openG20M24Course(page)
    expect(opened.model.kind).toBe('course-v9')

    // Same-model vision support. The user switches away from the requested page while
    // listChildren is held; the received PNG must remain the frozen green target.
    await selectG20M24Page(page, 0)
    await selectG20M24Object(page, G20_M24_PAGES[0].textId)
    const direct = model.arm('direct-noncurrent', 'direct', G20_M24_PAGES[1].label, G20_M24_MODELS.direct); rounds.push(direct)
    await sendG20M24Task(page, direct.id, `观察“${direct.targetLabel}”，识别背景色。`)
    await waitForRound(page, direct)
    await selectG20M24Page(page, 2)
    await selectG20M24Object(page, G20_M24_PAGES[2].textId)
    const beforeDirectCapture = await captureG20M24EditorState(page, opened.documentId)
    await saveScreenshot(page, fixture.directory, 'direct-held-user-on-blue', info)
    direct.release()
    await expectFinished(page, direct.id)
    const afterDirect = await captureG20M24EditorState(page, opened.documentId)
    facts.directNoncurrent = { before: comparableState(beforeDirectCapture), after: comparableState(afterDirect), round: direct }
    expect(direct.imageReceipt?.model).toBe(G20_M24_MODELS.direct)
    expect(direct.imageReceipt?.targetLabel).toBe(G20_M24_PAGES[1].label)
    expect(direct.observation).toMatchObject({ source: 'isolated-published', identity: { locationId: G20_M24_PAGES[1].id } })
    expect(direct.imageReceipt?.pixelCounts[G20_M24_PAGES[1].label]).toBeGreaterThan(20_000)
    expect(afterDirect.selectedPage).toContain(G20_M24_PAGES[2].label)
    expect(comparableState(afterDirect)).toEqual(comparableState(beforeDirectCapture))
    await info.attach('M24 direct model actual observation PNG', { path: direct.imageReceipt!.pngPath, contentType: 'image/png' })

    // Conversation model has no vision fact; the configured visual role receives
    // one separate actual PNG request, whose conclusion returns with provenance.
    await configureG20M24Roles(page, connectionId, G20_M24_MODELS.chat, G20_M24_MODELS.vision, true)
    const fallback = model.arm('vision-fallback-current', 'fallback', G20_M24_PAGES[2].label, G20_M24_MODELS.chat); rounds.push(fallback)
    await sendG20M24Task(page, fallback.id, `观察当前“${fallback.targetLabel}”，识别背景色。`)
    await waitForRound(page, fallback)
    const beforeFallback = await captureG20M24EditorState(page, opened.documentId)
    await saveScreenshot(page, fixture.directory, 'fallback-held-user-on-blue', info)
    fallback.release()
    await expectFinished(page, fallback.id)
    const afterFallback = await captureG20M24EditorState(page, opened.documentId)
    facts.separateVisionFallback = { before: comparableState(beforeFallback), after: comparableState(afterFallback), round: fallback }
    expect(fallback.visualRequest?.model).toBe(G20_M24_MODELS.vision)
    expect(fallback.visualRequest?.targetLabel).toBe(G20_M24_PAGES[2].label)
    expect(fallback.observation).toMatchObject({ source: 'isolated-published', identity: { locationId: G20_M24_PAGES[2].id } })
    expect(fallback.visualRequest?.pixelCounts[G20_M24_PAGES[2].label]).toBeGreaterThan(20_000)
    expect(comparableState(afterFallback)).toEqual(comparableState(beforeFallback))
    await info.attach('M24 separate vision actual observation PNG', { path: fallback.visualRequest!.pngPath, contentType: 'image/png' })

    // With no visual role and no capability fact for the chat model, unknown vision
    // inherits the conversation route and sends that model the actual captured PNG.
    await configureG20M24Roles(page, connectionId, G20_M24_MODELS.chat, null, false)
    const roleSettings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    expect(roleSettings.profile.roles.vision).toBeNull()
    expect(roleSettings.capabilityRecords?.find(record => record.connectionId === connectionId
      && record.model === G20_M24_MODELS.chat)?.facts.vision).toBeUndefined()
    const inherited = model.arm('vision-unknown-inherited', 'direct', G20_M24_PAGES[0].label, G20_M24_MODELS.chat); rounds.push(inherited)
    await sendG20M24Task(page, inherited.id, `观察“${inherited.targetLabel}”，识别背景色。`)
    await waitForRound(page, inherited)
    const beforeInherited = await captureG20M24EditorState(page, opened.documentId)
    await saveScreenshot(page, fixture.directory, 'unknown-inherited-held-user-on-blue', info)
    inherited.release()
    await expectFinished(page, inherited.id)
    const afterInherited = await captureG20M24EditorState(page, opened.documentId)
    facts.unknownVisionInherited = { before: comparableState(beforeInherited), after: comparableState(afterInherited), round: inherited }
    expect(inherited.imageReceipt?.model).toBe(G20_M24_MODELS.chat)
    expect(inherited.imageReceipt?.targetLabel).toBe(G20_M24_PAGES[0].label)
    expect(inherited.observation).toMatchObject({ source: 'isolated-published', identity: { locationId: G20_M24_PAGES[0].id } })
    expect(inherited.imageReceipt?.pixelCounts[G20_M24_PAGES[0].label]).toBeGreaterThan(20_000)
    expect(inherited.visualRequest).toBeUndefined()
    expect(comparableState(afterInherited)).toEqual(comparableState(beforeInherited))
    expect(inherited.completed).toBe(true)
    await info.attach('M24 unknown capability inherited conversation PNG', { path: inherited.imageReceipt!.pngPath, contentType: 'image/png' })

    // A genuine user text edit after the page handle is issued makes that handle stale.
    // The model gets the rejection and no screenshot from the old revision.
    await selectG20M24Page(page, 2)
    await selectG20M24Object(page, G20_M24_PAGES[2].textId)
    const preEdit = await readG20M24Document(page, opened.documentId)
    const stale = model.arm('stale-after-edit', 'stale', G20_M24_PAGES[1].label, G20_M24_MODELS.chat); rounds.push(stale)
    await sendG20M24Task(page, stale.id, `读取“${stale.targetLabel}”后观察；如果版本变化则拒绝旧目标。`)
    await waitForRound(page, stale)
    await editG20M24SelectedTitle(page, G20_M24_PAGES[2].textId, '蓝色目标页标题已手动修改')
    const afterHumanEdit = await readG20M24Document(page, opened.documentId)
    expect(afterHumanEdit.revision).toBeGreaterThan(preEdit.revision)
    const beforeStaleRelease = await captureG20M24EditorState(page, opened.documentId)
    await saveScreenshot(page, fixture.directory, 'stale-held-after-real-edit', info)
    stale.release()
    await expectFinished(page, stale.id)
    const afterStale = await captureG20M24EditorState(page, opened.documentId)
    facts.staleAfterEdit = { before: comparableState(beforeStaleRelease), after: comparableState(afterStale), round: stale }
    expect(stale.staleToolResult).toMatchObject({ kind: 'error' })
    expect(stale.observation).toBeUndefined()
    expect(afterStale.revision).toBe(beforeStaleRelease.revision)
    expect(afterStale.undoDepth).toBe(beforeStaleRelease.undoDepth)
    expect(afterStale.redoDepth).toBe(beforeStaleRelease.redoDepth)
    expect(afterStale.selectedPage).toBe(beforeStaleRelease.selectedPage)
    expect(afterStale.selectionToolbar).toEqual(beforeStaleRelease.selectionToolbar)
    expect(afterStale.viewport).toEqual(beforeStaleRelease.viewport)
    const staleRequests = model.requests.filter(request => request.messages?.some(message => typeof message.content === 'string' && message.content.includes(stale.id)))
    expect(staleRequests.some(request => request.messages?.some(message => Array.isArray(message.content)
      && (message.content as Array<{ type?: string }>).some(part => part.type === 'image_url')))).toBe(false)
    facts.finalDocument = { revision: afterStale.revision, undoDepth: afterStale.undoDepth, redoDepth: afterStale.redoDepth,
      humanEditFromRevision: preEdit.revision, actualTitle: '蓝色目标页标题已手动修改' }
    expect(capture.pageErrors).toEqual([])
    facts.status = 'passed'
  } catch (error) {
    failure = error
    facts.status = 'failed'
    facts.failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    for (const round of rounds) round.release()
    facts.rounds = rounds
    facts.modelRequests = summarizeRequests(model.requests)
    facts.modelErrors = rounds.flatMap(round => round.error ? [{ id: round.id, error: round.error }] : [])
    if (app && page && capture) {
      await attachG20M24Evidence(fixture, page, app, info, facts, capture)
      await closeG20M24App(app)
    }
    await model.close()
    if (failure) facts.status = 'failed'
  }
})

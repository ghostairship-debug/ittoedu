import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { MaterialRepository } from '../../src/main/materialRepository'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { captureCourseAuthoringTarget } from '../../src/renderer/authoring/courseAuthoringSession'
import { projectEffectiveLayers } from '../../src/renderer/course/effectiveLayerProjection'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { APP_NAME } from '../../src/shared/constants'
import { generationCandidateSchema, generationRequestSchema } from '../../src/shared/generationContract'
import { GENERATION_CLOSE, GENERATION_OPEN } from '../../src/shared/generationResult'
import { localAgentRecordV2Schema } from '../../src/shared/localAgentTaskContract'
import { workspaceIdentityKey } from '../../src/shared/workspaceIdentity'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const root = resolve(__dirname, '../..')
type Owner = { projectId: string; projectPath: string }

/** Seed formal local repositories only; this is not evidence of a native model run. */
async function seedWorkspace(profile: string, projectPath: string, label: 'A' | 'B') {
  const project = createBlankCourseProject({ title: `R18 workspace ${label}`, includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Expected the blank Slide fixture')
  const item = sceneNodeToCourseLayerItem(createTextNode({ text: `Original content ${label}` }), 0)
  surface.scenes[0]!.layerItems.push(item)
  writeFileSync(projectPath, createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
  const workspace = createWorkspaceIdentity(project.id, projectPath)
  const projection = projectEffectiveLayers({ project, locationId: project.startLocationId })
  const row = projection.unifiedRows.find(value => value.id === item.layerItemId)!
  const destination = { kind: 'update' as const, target: captureCourseAuthoringTarget({
    sessionToken: { locationId: projection.locationId, surfaceType: 'slide', revision: project.revision, generation: 1 },
    projectId: project.id, surfaceId: surface.id, stateId: projection.stateId,
    owner: row.owner, ownerKey: row.ownerKey, itemId: row.id, authoringAddress: row.authoringAddress,
  }) }
  const marker = `Repository seeded conversation ${label}`
  const request = generationRequestSchema.parse({ version: 1, requestId: randomUUID(), workspace,
    documentRevision: project.revision, sessionGeneration: 1, purpose: 'local-edit', expectedResult: 'candidate',
    intent: 'edit', applyPolicy: 'preview', instruction: `Unapplied fixture edit ${label}`,
    allowedCarriers: ['native'], destinations: [destination], context: {},
  })
  const candidate = generationCandidateSchema.parse({ version: 1, requestId: request.requestId, candidateId: randomUUID(),
    summary: `Unapplied candidate ${label}`, steps: [{ id: 'text', tool: 'native.content', carrier: 'native',
      destination, input: { operation: 'edit', text: `MUST NOT BE APPLIED ${label}` } }],
  })
  const id = randomUUID(), taskId = randomUUID(), observationId = randomUUID(), runId = randomUUID(), time = Date.now()
  const identity = { version: 2 as const, sessionId: id, taskId, epoch: 0, workspace, runId, nativeTurnId: `seeded-turn-${label}` }
  const record = localAgentRecordV2Schema.parse({ version: 2, id, adapter: 'codex', workspace,
    externalSessionId: `seeded-native-session-${label}`, workingDirectoryId: id,
    tasks: [{ version: 1, taskId, epoch: 0, workspace, sessionId: id, adapter: 'codex', goal: request.instruction,
      intent: 'edit', applyPolicy: 'preview', readScope: { kind: 'course' }, writeDestinations: [destination],
      status: 'awaiting-apply', observationId, committedResultIds: [] }],
    observations: [{ version: 1, taskId, epoch: 0, workspace, observationId, capturedAt: time,
      documentRevision: project.revision, sessionGeneration: 1, draftEpoch: null, viewEpoch: null, runtime: null,
      surfaceId: surface.id, locationId: project.startLocationId, stateId: null,
      source: 'generation-snapshot', readScope: { kind: 'course' }, files: [] }],
    hostResults: [], events: [
      { ...identity, sequence: 1, time, kind: 'text', itemId: 'reply', phase: 'body', operation: 'replace', text: marker },
      { ...identity, sequence: 2, time, kind: 'text', itemId: 'candidate', phase: 'candidate', operation: 'replace',
        text: `${GENERATION_OPEN}${JSON.stringify(candidate)}${GENERATION_CLOSE}` },
      { ...identity, sequence: 3, time, kind: 'turn-ended', status: 'completed', failure: null },
    ],
  })
  const repository = new LocalAgentRepository(profile)
  await repository.writeObservation(workspace, id, observationId, 'generation-request.json', JSON.stringify(request))
  await repository.write(record)
  const material = await new MaterialRepository(profile).import(workspace, {
    title: `Exclusive material ${label}`, text: `Exclusive teaching body ${label}`,
    source: { kind: 'text', locator: `Seeded source ${label}` },
  })
  return { project, workspace, owner: { projectId: project.id, projectPath }, id, marker, material, externalSessionId: record.externalSessionId }
}
type Seed = Awaited<ReturnType<typeof seedWorkspace>>

async function launch(profile: string) {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    expect(resolve(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(resolve(profile))
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.locator('[data-testid="canvas-stage"] canvas').first().waitFor()
    await expectBackgroundWindowsIsolated(app, true)
    const professional = page.getByRole('button', { name: '专业', exact: true })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
    return { app, page, pageErrors }
  } catch (error) { await app.close(); throw error }
}

async function dialogs(app: ElectronApplication, paths: { open?: string; save?: string }) {
  await app.evaluate(({ dialog }, paths) => {
    // Stub only native file pickers. Open and Save As still use the real UI and lifecycle owners.
    dialog.showOpenDialog = (async () => ({ canceled: !paths.open, filePaths: paths.open ? [paths.open] : [] })) as typeof dialog.showOpenDialog
    dialog.showSaveDialog = (async () => ({ canceled: !paths.save, filePath: paths.save })) as typeof dialog.showSaveDialog
  }, paths)
}

function readProject(projectPath: string) {
  return openCourseProjectArchive(new Uint8Array(readFileSync(projectPath))).project
}

async function openProject(app: ElectronApplication, page: Page, owner: Owner, title: string) {
  await dialogs(app, { open: owner.projectPath })
  await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
  await expect.poll(() => page.title()).toBe(`${title} - ${APP_NAME}`)
}

async function assertSavedUnchanged(page: Page, owner: Owner, project: Seed['project']) {
  const before = statSync(owner.projectPath).mtimeMs
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
  await expect.poll(() => statSync(owner.projectPath).mtimeMs).toBeGreaterThan(before)
  // Parsing a real UI save catches an accidental in-memory replay, not just untouched disk bytes.
  expect(readProject(owner.projectPath)).toEqual(project)
}

async function inspectWorkspace(page: Page, owner: Owner, expected: Seed | null, other: Seed) {
  const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
  if (!await chat.count()) await page.getByRole('button', { name: '创作助手', exact: true }).click()
  await expect(chat).toBeVisible()
  await expect.poll(() => chat.getByLabel('会话', { exact: true }).locator('option').evaluateAll(options =>
    options.map(option => (option as HTMLOptionElement).value))).toEqual(expected ? ['', expected.id] : [''])
  await expect(chat.getByText(other.marker, { exact: true })).toHaveCount(0)
  if (expected) {
    await chat.getByLabel('会话', { exact: true }).selectOption(expected.id)
    await expect(chat.getByText(expected.marker, { exact: true })).toBeVisible()
    await chat.getByText('引用教学材料（0）', { exact: true }).click()
    await expect(chat.getByLabel(expected.material.title, { exact: true })).toBeVisible()
  }
  await expect(chat.getByLabel(other.material.title, { exact: true })).toHaveCount(0)
  await expect(chat.getByRole('button', { name: '应用候选', exact: true })).toHaveCount(0)
  await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeDisabled()
  const state = await page.evaluate(async ({ owner, other }) => {
    const sessions = await window.desktopAPI.localAgent({ operation: 'list', ...owner })
    const materials = await window.desktopAPI.materials({ operation: 'search', ...owner, query: '' })
    const foreignSession = await window.desktopAPI.localAgent({ operation: 'read', ...owner, sessionId: other.id, after: 0 })
    const foreignMaterial = await window.desktopAPI.materials({ operation: 'read', ...owner, id: other.material.id })
      .then(records => ({ rejected: false, message: '', records }), error => ({ rejected: true, message: String(error), records: [] }))
    return { sessions, materials, foreignSession, foreignMaterial }
  }, { owner, other: { id: other.id, material: { id: other.material.id } } })
  expect(state.sessions.records?.map(record => record.id)).toEqual(expected ? [expected.id] : [])
  expect(state.sessions.damaged).toEqual([])
  expect(state.materials).toEqual(expected ? [expected.material] : [])
  expect(state.foreignSession.records).toEqual([])
  expect(state.foreignMaterial.rejected).toBe(true)
  // Electron contextBridge transports the safe message, but not the custom Error.name.
  expect(state.foreignMaterial.message).toContain('材料操作失败：无法完成本地材料操作。\n请检查工程路径或材料文件后重试。')
  if (expected) expect(state.sessions.records?.[0]).toMatchObject({ workspace: expected.workspace,
    externalSessionId: expected.externalSessionId,
    task: { status: 'failed', committedStages: 0 } })
  await page.getByLabel('创作工具', { exact: true }).click()
  await page.getByRole('menuitem').filter({ hasText: '教学材料库' }).click()
  const library = page.getByRole('dialog', { name: '教学材料库' })
  await expect(library.getByText(`${expected ? 1 : 0} 条材料`, { exact: true })).toBeVisible()
  if (expected) await expect(library.getByText(expected.material.text, { exact: true })).toBeVisible()
  await expect(library.getByText(other.material.text, { exact: true })).toHaveCount(0)
  await library.getByRole('button', { name: '关闭', exact: true }).click()
  return { owner, sessions: state.sessions.records?.map(record => ({ id: record.id, workspace: record.workspace, task: record.task })),
    materialIds: state.materials.map(material => material.id), candidateReplayed: false }
}

test('S3 workspace isolation: A/B sessions and materials survive restart while Save As C stays empty', async ({}, testInfo) => {
  // Two Electron starts and seven UI open/material/save cycles exceeded the
  // initial whole-scenario deadline; individual action/assertion limits stay unchanged.
  test.setTimeout(180_000)
  const runRoot = join(root, 'output', 'r18-workspace-isolation', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
  mkdirSync(runRoot, { recursive: true })
  const profile = join(runRoot, 'profile')
  let editor: Awaited<ReturnType<typeof launch>> | undefined
  const evidence: unknown[] = []
  let completed = false, failure: string | undefined
  const captureState = async (phase: string, owner: Owner, expected: Seed | null, other: Seed) => {
    const observation = await inspectWorkspace(editor!.page, owner, expected, other)
    const screenshot = join(runRoot, `${phase}.png`)
    evidence.push({ phase, ...observation, screenshot })
    await editor!.page.screenshot({ path: screenshot })
  }
  try {
    const a = await seedWorkspace(profile, join(runRoot, 'A.h5lesson'), 'A')
    const b = await seedWorkspace(profile, join(runRoot, 'B.h5lesson'), 'B')
    const c = { projectId: a.project.id, projectPath: join(runRoot, 'C.h5lesson') }
    expect(workspaceIdentityKey(a.workspace)).not.toBe(workspaceIdentityKey(b.workspace))
    editor = await launch(profile)
    for (const [index, [current, other]] of [[a, b], [b, a], [a, b]].entries()) {
      await openProject(editor.app, editor.page, current.owner, current.project.title)
      await captureState(`before-restart-${index + 1}-${current === a ? 'A' : 'B'}`, current.owner, current, other)
      await assertSavedUnchanged(editor.page, current.owner, current.project)
    }
    await dialogs(editor.app, { save: c.projectPath })
    await editor.page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(() => existsSync(c.projectPath)).toBe(true)
    const savedAsIdentity = await editor.page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'workspace', ...owner }), c)
    expect(savedAsIdentity.workspace).toEqual(createWorkspaceIdentity(a.project.id, c.projectPath))
    expect(savedAsIdentity.workspace).not.toEqual(a.workspace)
    await captureState('before-restart-C', c, null, a)
    await assertSavedUnchanged(editor.page, c, a.project)
    expect(editor.pageErrors).toEqual([])
    await editor.app.close(); editor = undefined

    // A second Electron process uses exactly the same profile; nothing is reseeded.
    editor = await launch(profile)
    for (const [current, other] of [[a, b], [b, a]]) {
      await openProject(editor.app, editor.page, current.owner, current.project.title)
      await captureState(`after-restart-${current === a ? 'A' : 'B'}`, current.owner, current, other)
      await assertSavedUnchanged(editor.page, current.owner, current.project)
    }
    await openProject(editor.app, editor.page, c, a.project.title)
    await captureState('after-restart-C', c, null, a)
    await assertSavedUnchanged(editor.page, c, a.project)
    for (const current of [a, b]) {
      const persisted = await new LocalAgentRepository(profile).list(current.workspace)
      expect(persisted.v2).toHaveLength(1)
      expect(persisted.v2[0]!.hostResults).toEqual([])
      expect(persisted.v2[0]!.tasks[0]!.committedResultIds).toEqual([])
      // Three seeded events plus the one honest interrupted-task diagnosis; reopening adds no native turn.
      expect(persisted.v2[0]!.events).toHaveLength(4)
      expect(persisted.v2[0]!.events.filter(event => event.kind === 'text' && event.phase === 'candidate')).toHaveLength(1)
    }
    expect(editor.pageErrors).toEqual([])
    completed = true
  } catch (error) {
    failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    if (!completed && editor) await editor.page.screenshot({ path: join(runRoot, 'failure-current.png'), timeout: 5_000 }).catch(() => undefined)
    const report = JSON.stringify({
      completed, failure, runRoot, profile,
      projects: ['A', 'B', 'C'].map(label => ({ label, path: join(runRoot, `${label}.h5lesson`) })),
      fixture: 'Formal V2 session and material repositories seeded before first launch; no model turn requested.',
      measured: 'Real Electron UI open, history selection, material library, Save As, save, process restart and official IPC reads.',
      observations: evidence,
    }, null, 2)
    try {
      writeFileSync(join(runRoot, 'evidence.json'), report)
      await testInfo.attach('workspace-isolation-evidence', { contentType: 'application/json', body: report })
    } finally { await editor?.app.close() }
  }
})

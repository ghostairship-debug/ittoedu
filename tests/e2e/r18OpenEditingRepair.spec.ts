import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createShapeNode } from '../../src/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { FIXTURE_IDS, launchNativeEditor, closeNativeEditor, selectLayer, saveStage, nativeRecords, sendNatural, writeNativeLesson, imageItem, verifyGreenImage } from './r18NativeAuthoringFixture'
import { selectReferenceScope } from './chatReferenceTarget'

for (const natural of [false, true]) for (const adapter of (natural ? ['opencode', 'claude', 'codex'] : ['opencode', 'claude']) as ('opencode' | 'claude' | 'codex')[]) test(`${natural ? 'AG01 natural mechanism' : 'open editing repair'}: ${adapter} fresh profile`, async () => {
  test.skip(process.env.COURSEWARE_OPEN_EDITING_REPAIR !== '1', 'Explicit real native CLI check; not ordinary unit coverage')
  test.setTimeout(900_000)
  const root = resolve(natural ? 'output/native-editing-mechanism-20260914' : 'output/native-editing-repair-20260914', `${adapter}-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const project = createBlankCourseProject({ id: `${adapter}-open-editing`, includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Slide')
  surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: FIXTURE_IDS.image, name: '参照方形', x: 100, y: 100, width: 240, height: 240, style: { fillColor: '#ff0000' } }), 0))
  const second = structuredClone(surface.scenes[0]!)
  second.id = 'other-scene'; second.name = '目标页'
  second.layerItems = [sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'target-square', name: '目标方形', x: 400, y: 200, width: 240, height: 240, style: { fillColor: '#ff0000' } }), 0)]
  surface.scenes.push(second)
  project.locations.push({ id: 'other-page', kind: 'slide-scene', surfaceId: surface.id, sceneId: second.id, label: '目标页' })
  const projectPath = join(root, 'lesson.h5lesson')
  writeFileSync(projectPath, createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
  const run = await launchNativeEditor(resolve('.'), root, projectPath)
  try {
    await selectLayer(run.page, FIXTURE_IDS.image)
    await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption(adapter)
    await chat.locator('.native-agent-configuration summary').click()
    const model = chat.getByLabel('模型', { exact: true }), effort = chat.getByLabel('强度', { exact: true })
    await expect(model).toBeEnabled({ timeout: 90_000 })
    await model.selectOption(adapter === 'opencode' ? 'openai/gpt-5.6-luna-fast' : adapter === 'claude' ? 'fable' : 'gpt-6-astra')
    await expect(model).toBeEnabled({ timeout: 60_000 })
    await effort.selectOption(adapter === 'codex' ? 'medium' : 'max'); await expect(effort).toBeEnabled({ timeout: 60_000 })
    if (adapter === 'codex') {
      await expect(chat.getByText(/快速模式会增加用量消耗/)).toBeVisible()
      await chat.getByLabel('速度', { exact: true }).selectOption('priority')
      await expect(chat.getByLabel('速度', { exact: true })).toBeEnabled()
    }
    await selectReferenceScope(chat, 'selection')
    const instruction = '当前选中的参照方形保持不变。请把另一页“目标页”中的“目标方形”改成纯绿色 #00ff00，并在它正中新增一个直径120的纯黄色 #ffff00 圆形。方形和圆形必须是两个可单独选择编辑的原生图形，保留方形的位置尺寸，其他内容保持不变。'
      + (!natural && adapter === 'claude' ? '这次请走 CLI 文件兜底：编辑本轮冻结 V9 文档副本，通过 project.document 交回实际结果。' : '')
    await sendNatural(run, 'result', instruction, 750_000)
    const saved = await saveStage(run, 'saved-result'), after = saved.project.surfaces[0]!
    if (after.type !== 'slide') throw new Error('Slide')
    expect(after.scenes[0]).toEqual(surface.scenes[0])
    const items = after.scenes.find(scene => scene.id === second.id)!.layerItems
    expect(items).toHaveLength(2)
    const square = items.find(item => item.layerItemId === 'target-square')!, circle = items.find(item => item.layerItemId !== 'target-square')!
    expect(square).toMatchObject({ frame: second.layerItems[0]!.frame, content: { nativeType: 'shape', data: { shapeType: 'rectangle', style: { fillColor: '#00ff00' } } } })
    expect(circle).toMatchObject({ kind: 'native', frame: { x: 460, y: 260, width: 120, height: 120 }, content: { nativeType: 'shape', data: { shapeType: 'ellipse', style: { fillColor: '#ffff00' } } } })
    const records = nativeRecords(run)
    if (adapter === 'codex') expect(records.flatMap(record => record.tasks.flatMap(task => task.configurationRuns ?? []))).toContainEqual(expect.objectContaining({ requested: { model: 'gpt-6-astra', effort: 'medium', serviceTier: 'priority' }, sent: { model: 'gpt-6-astra', effort: 'medium', serviceTier: 'priority' }, confirmed: expect.objectContaining({ model: 'gpt-6-astra', effort: 'medium', serviceTier: 'priority' }) }))
    const committed = records.flatMap(record => record.hostResults.filter(result => result.status === 'committed'))
    expect(committed).toHaveLength(1)
    await run.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await run.page.getByTestId('scene-item-other-page').click()
    await selectLayer(run.page, square.layerItemId)
    await selectLayer(run.page, circle.layerItemId)
    await run.page.screenshot({ path: join(root, 'reopened-target.png'), animations: 'disabled' })
    writeFileSync(join(root, 'acceptance.json'), JSON.stringify({ adapter, instruction, savedRevision: saved.project.revision,
      reopenedTarget: true, independentlySelected: [square.layerItemId, circle.layerItemId],
      configured: records.flatMap(record => record.tasks.flatMap(task => task.configurationRuns)),
      permissionQuestions: records.flatMap(record => record.events.filter(event => event.kind === 'question')).length,
      natural, receipts: committed, rejectedCandidates: records.flatMap(record => record.hostResults.filter(result => result.status === 'rejected')).length, ownerAcceptance: false }, null, 2))
  } finally { await closeNativeEditor(run) }
})


test('native fixture closes an isolated editor without a competing quit call', async () => {
  const root = resolve('output/native-editing-mechanism-20260914', `shutdown-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const projectPath = join(root, 'lesson.h5lesson')
  await writeNativeLesson(projectPath)
  const run = await launchNativeEditor(resolve('.'), root, projectPath)
  const exited = new Promise<void>(resolve => run.app.process().once('exit', () => resolve()))
  await closeNativeEditor(run)
  await exited
})

for (const scenario of ['AG02 image composition', 'AG03 new page media'] as const) test(`${scenario}: natural mechanism`, async () => {
  test.skip(process.env.COURSEWARE_OPEN_EDITING_REPAIR !== '1', 'Explicit real native CLI check')
  test.setTimeout(900_000)
  const adapter = scenario.startsWith('AG02') ? 'opencode' : 'claude'
  const root = resolve('output/native-editing-mechanism-20260914', `${scenario.slice(0, 4)}-${adapter}-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const projectPath = join(root, 'lesson.h5lesson'), before = await writeNativeLesson(projectPath)
  const originalSurface = before.project.surfaces[0]!
  if (originalSurface.type !== 'slide') throw new Error('slide')
  const shared = { ...structuredClone(imageItem(before.project)), layerItemId: 'shared-image', label: '共享素材参照', frame: { ...imageItem(before.project).frame, x: 700, y: 500, width: 180, height: 120 }, order: 3 }
  originalSurface.scenes[0]!.layerItems.push(shared)
  writeFileSync(projectPath, createCourseProjectArchive(before))
  const run = await launchNativeEditor(resolve('.'), root, projectPath)
  try {
    await selectLayer(run.page, FIXTURE_IDS.image)
    await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption(adapter)
    await chat.locator('.native-agent-configuration summary').click()
    await expect(chat.getByLabel('模型', { exact: true })).toBeEnabled({ timeout: 90_000 })
    await chat.getByLabel('模型', { exact: true }).selectOption(adapter === 'opencode' ? 'openai/gpt-5.6-luna-fast' : 'fable')
    await expect(chat.getByLabel('模型', { exact: true })).toBeEnabled({ timeout: 60_000 })
    await chat.getByLabel('强度', { exact: true }).selectOption('max')
    await expect(chat.getByLabel('强度', { exact: true })).toBeEnabled({ timeout: 60_000 })
    await selectReferenceScope(chat, 'selection')
    const instruction = scenario.startsWith('AG02')
      ? '把选中的红色图片中红色部分改成绿色 #00ff00，保留透明圆角和白色细节；在这张图片正中心新增一个直径120的纯黄色 #ffff00 圆形。图片和圆形必须可以分别选中编辑，不要合成一张图片。保留图片位置尺寸，右下方共享素材参照及其他对象保持不变。'
      : '新增一张名为“素材页”的演示页，把当前选中的红色图片作为新页的背景，完整显示。原页的图片、标题、方形和共享素材参照都保持不变。'
    await sendNatural(run, 'result', instruction, 750_000)
    const after = await saveStage(run, 'saved-result')
    let geometry: unknown
    if (scenario.startsWith('AG02')) {
      geometry = await verifyGreenImage(before, after)
      const surface = after.project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('slide')
      const items = surface.scenes[0]!.layerItems, priorIds = new Set(originalSurface.scenes[0]!.layerItems.map(item => item.layerItemId))
      expect(items).toHaveLength(originalSurface.scenes[0]!.layerItems.length + 1)
      const circle = items.find(item => !priorIds.has(item.layerItemId))!
      expect(circle).toMatchObject({ kind: 'native', frame: { x: 270, y: 325, width: 120, height: 120 }, content: { nativeType: 'shape', data: { shapeType: 'ellipse', style: { fillColor: '#ffff00' } } } })
      for (const item of originalSurface.scenes[0]!.layerItems.filter(item => item.layerItemId !== FIXTURE_IDS.image)) expect(items.find(next => next.layerItemId === item.layerItemId)).toEqual(item)
      await run.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
      await selectLayer(run.page, FIXTURE_IDS.image); await selectLayer(run.page, circle.layerItemId)
    } else {
      expect(after.project.locations).toHaveLength(before.project.locations.length + 1)
      const original = after.project.surfaces.find(surface => surface.id === originalSurface.id)!
      if (original.type !== 'slide') throw new Error('slide')
      expect(original.scenes.find(scene => scene.id === originalSurface.scenes[0]!.id)).toEqual(originalSurface.scenes[0])
      const location = after.project.locations.find(location => !before.project.locations.some(prior => prior.id === location.id))!
      const surface = after.project.surfaces.find(surface => surface.id === location.surfaceId)!
      if (surface.type !== 'slide' || location.kind !== 'slide-scene') throw new Error('new slide')
      const scene = surface.scenes.find(scene => scene.id === location.sceneId)!
      expect(scene.name).toBe('素材页'); expect(scene.backgroundAssetId).toBe(FIXTURE_IDS.asset)
      expect(after.project.backgroundAssetId).toBe(before.project.backgroundAssetId)
      await run.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
      await run.page.getByTestId(`scene-item-${location.id}`).click()
    }
    await run.page.screenshot({ path: join(root, 'reopened-result.png'), animations: 'disabled' })
    const records = nativeRecords(run)
    writeFileSync(join(root, 'acceptance.json'), JSON.stringify({ scenario, adapter, instruction, geometry,
      configurations: records.flatMap(record => record.tasks.flatMap(task => task.configurationRuns ?? [])),
      rejectedCandidates: records.flatMap(record => record.hostResults.filter(result => result.status === 'rejected')).length,
      receipts: records.flatMap(record => record.hostResults.filter(result => result.status === 'committed')), ownerAcceptance: false }, null, 2))
  } finally { await closeNativeEditor(run) }
})

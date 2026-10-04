import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chooseM20Workspace, closeM20, launchM20 } from './helpers/g20M20Harness'
import { root, settledRect } from './helpers/g20M19Harness'
import { canvasReady } from './helpers/g20M21Harness'

/** Read the live selection/placement props only; never inject a selection or invoke an editor command. */
async function selectionFacts(page: Page, controllerId: string) {
  return page.evaluate(id => {
    const marker = document.querySelector<HTMLElement>('.native-selection-context')
    const fiberKey = marker && Object.keys(marker).find(key => key.startsWith('__reactFiber$'))
    type Fiber = { memoizedProps?: Record<string, unknown>; return?: Fiber; child?: Fiber; sibling?: Fiber }
    let fiber = marker && fiberKey ? (marker as unknown as Record<string, Fiber>)[fiberKey] : undefined
    while (fiber && !Array.isArray(fiber.memoizedProps?.itemIds)) fiber = fiber.return
    const props = fiber?.memoizedProps
    const placement = (node: Fiber | undefined): Record<string, unknown> | null => {
      if (!node) return null
      if (node.memoizedProps?.label === '选中对象快捷工具') {
        const { anchor, bounds, suspended } = node.memoizedProps
        return { anchor, bounds, suspended }
      }
      return placement(node.child) ?? placement(node.sibling)
    }
    const bar = document.querySelector<HTMLElement>('[data-selection-quick-bar]')
    const rect = bar?.getBoundingClientRect(), style = bar && getComputedStyle(bar)
    return {
      markerPresent: Boolean(marker), enabled: props?.enabled ?? null,
      selection: props?.itemIds ?? null, locationId: props?.locationId ?? null,
      stateId: props?.stateId ?? null, textEditing: props?.textEditing ?? null,
      explicitAnchor: typeof props?.bounds === 'function' ? props.bounds(id) : null,
      quickBar: placement(fiber?.child),
      renderedBar: bar ? { visibility: style?.visibility, display: style?.display,
        suspended: bar.dataset.suspended ?? null,
        bounds: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        buttons: [...bar.querySelectorAll('button')].map(button => button.getAttribute('aria-label')) } : null,
      editMode: document.querySelector('main.workspace')?.className ?? null,
      hitAtControllerCentre: (() => {
        const controller = [...document.querySelectorAll<HTMLElement>('[data-controller-authoring-id]')]
          .find(node => node.dataset.controllerAuthoringId === id)
        const box = controller?.getBoundingClientRect()
        const hit = box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return hit ? { tag: hit.tagName, className: hit.getAttribute('class') } : null
      })(),
    }
  }, controllerId)
}

test('default Slide authoring: a real mouse click on the teacher controller exposes AI modification', async ({}, info) => {
  test.setTimeout(90_000)
  const base = join(root, 'output/playwright/teacher-controller-selection')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const { app, page } = await launchM20({ directory, workspace, profile: join(directory, 'profile') })
  const errors: string[] = [], evidence: Record<string, unknown> = { directory, scenario: 'UI-created default Slide course' }
  page.on('pageerror', error => errors.push(error.message))
  let controllerId = ''
  try {
    await chooseM20Workspace(app, page, workspace)
    const priorIds = await page.evaluate(async () => (await window.desktopAPI.documents!.list()).map(entry => entry.documentId))
    await page.getByLabel('新建标签页', { exact: true }).click()
    await page.locator('.lesson-new-tab-popover').getByRole('button', { name: '新建 H5 演示', exact: true }).click()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    await canvasReady(page)
    const before = await page.evaluate(async prior => (await window.desktopAPI.documents!.list())
      .find(entry => entry.model.kind === 'course-v9' && !prior.includes(entry.documentId)), priorIds)
    if (!before || before.model.kind !== 'course-v9') throw new Error('UI did not create a new course')
    const controllers = before.model.project.globalLayerItems.filter(entry => entry.item.kind === 'component' && entry.item.role === 'teacher-controller')
    expect(controllers).toHaveLength(1)
    controllerId = controllers[0]!.item.layerItemId
    expect(before.model.project.surfaces[0]?.type).toBe('slide')
    evidence.before = { documentId: before.documentId, revision: before.revision, undoDepth: before.undoDepth,
      controllerId, startLocationId: before.model.project.startLocationId }
    evidence.beforeClick = await selectionFacts(page, controllerId)
    const box = await settledRect(page, `[data-controller-authoring-id="${controllerId}"]`, { x: 8, y: 8 })
    evidence.clicked = { box, x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const toolbar = page.getByRole('toolbar', { name: '选中对象快捷工具', exact: true })
    await expect(toolbar).toBeVisible()
    await expect(toolbar).toContainText('教师控制台')
    const ai = toolbar.getByRole('button', { name: 'AI 修改', exact: true })
    await expect(ai).toBeVisible()
    evidence.afterClick = await selectionFacts(page, controllerId)
    expect((evidence.afterClick as Awaited<ReturnType<typeof selectionFacts>>).selection).toEqual([controllerId])
    const shot = join(directory, 'controller-selected.png')
    await page.screenshot({ path: shot })
    await info.attach('controller selected with AI quick bar', { path: shot, contentType: 'image/png' })
    await ai.click()
    await expect(page.getByRole('dialog', { name: /^AI 修改：/ })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'AI 修改要求', exact: true })).toBeVisible()
    const after = await page.evaluate(id => window.desktopAPI.documents!.read(id), before.documentId)
    expect(after.revision).toBe(before.revision)
    expect(after.undoDepth).toBe(before.undoDepth)
    evidence.after = { revision: after.revision, undoDepth: after.undoDepth, aiCardOpened: true, modelRequestSent: false }
    expect(errors).toEqual([])
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    evidence.failureConditions = await selectionFacts(page, controllerId).catch(reason => ({ diagnosticFailure: String(reason) }))
    const shot = join(directory, 'failure.png')
    await page.screenshot({ path: shot }).then(() => info.attach('failure', { path: shot, contentType: 'image/png' })).catch(() => {})
    console.log('Teacher controller selection failure conditions:', JSON.stringify(evidence.failureConditions))
    throw error
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ ...evidence, errors }, null, 2))
    await info.attach('selection conditions', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    await closeM20(app)
  }
})

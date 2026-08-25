import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { parseComponentPackageFiles } from '../../src/renderer/components/importComponentPackage'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import type { ComponentPackageData } from '../../src/shared/componentTypes'

const root = resolve(__dirname, '..', '..')
const runRoot = mkdtempSync(join(tmpdir(), 'sample-v9-published-'))
const standalonePath = join(runRoot, 'sample-v9.html')
let controllerItemId = ''
let nextButtonId = ''

test.beforeAll(() => {
  const opened = openCourseProjectArchive(Uint8Array.from(readFileSync(
    join(root, 'examples', 'sample-project.h5lesson'),
  )))
  const components: Record<string, ComponentPackageData> = Object.create(null) as Record<
    string,
    ComponentPackageData
  >
  for (const [key, files] of Object.entries(opened.componentFiles)) {
    components[key] = parseComponentPackageFiles(files)
  }
  const controller = opened.project.globalLayerItems.find(
    (entry) => entry.item.kind === 'native' &&
      entry.item.content.nativeType === 'teacher-controller',
  )
  if (
    !controller ||
    controller.item.kind !== 'native' ||
    controller.item.content.nativeType !== 'teacher-controller'
  ) {
    throw new Error('sample V9 project has no global teacher controller')
  }
  const nextButton = controller.item.content.data.buttons.find(
    (button) => button.action.type === 'scene.next' && button.visible,
  )
  if (!nextButton) throw new Error('sample teacher controller has no visible next button')
  controllerItemId = controller.item.layerItemId
  nextButtonId = nextButton.id
  const playerBundle = readFileSync(
    join(root, 'dist-player', 'player.iife.js'),
    'utf8',
  )
  writeFileSync(standalonePath, buildPublishedCourseStandaloneHtml({
    project: opened.project,
    assetFiles: opened.assetFiles,
    components,
  }, playerBundle), 'utf8')
})

test.afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true })
})

test('committed V9 sample publishes an interactive offline Phaser counter', async ({ page }) => {
  const pageErrors: string[] = []
  const externalRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    if (/^(?:https?|wss?):/i.test(request.url())) externalRequests.push(request.url())
  })
  await page.addInitScript(() => {
    window.addEventListener('courseware-component-event', (event) => {
      Reflect.set(window, '__sampleCounterEvent', (event as CustomEvent).detail)
    })
  })

  await page.goto(pathToFileURL(standalonePath).toString())
  await page.waitForFunction(() => Boolean(window.__H5_LESSON_PLAYER__))
  const controller = page.locator(
    `[data-global-layer-item="${controllerItemId}"] .slide-native-teacher-controller`,
  )
  await expect(controller).toBeVisible()
  const nextButton = controller.locator(
    `[data-controller-button-id="${nextButtonId}"]`,
  )
  if (!await nextButton.isVisible()) {
    const expand = controller.locator('[data-teacher-controller-collapse="true"]')
    const expandBounds = await expand.boundingBox()
    if (!expandBounds) throw new Error('sample controller expand button has no bounds')
    await page.mouse.click(
      expandBounds.x + expandBounds.width / 2,
      expandBounds.y + expandBounds.height / 2,
    )
  }
  await expect(nextButton).toBeVisible()
  const nextButtonBounds = await nextButton.boundingBox()
  if (!nextButtonBounds) throw new Error('sample controller next button has no bounds')
  await page.mouse.click(
    nextButtonBounds.x + nextButtonBounds.width / 2,
    nextButtonBounds.y + nextButtonBounds.height / 2,
  )
  await expect.poll(() => page.evaluate(
    () => window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex(),
  )).toBe(1)

  const canvas = page.locator(
    '[data-published-phaser-component="component_sample_counter"]',
  )
  await expect(canvas).toBeVisible({ timeout: 15_000 })
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('sample Phaser canvas has no bounds')
  await page.mouse.click(
    bounds.x + (356 / 480) * bounds.width,
    bounds.y + (238 / 280) * bounds.height,
  )

  await expect.poll(() => page.evaluate(() => Reflect.get(
    window,
    '__sampleCounterEvent',
  ))).toMatchObject({
    scope: 'scene',
    componentId: 'com.example.sample-counter',
    instanceId: 'component_sample_counter',
    eventName: 'change',
    payload: { value: 1 },
  })
  expect(pageErrors).toEqual([])
  expect(externalRequests).toEqual([])
})

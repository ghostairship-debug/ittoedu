import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { parseComponentPackageFiles } from '../../src/renderer/components/importComponentPackage'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import type { ComponentPackageData } from '../../src/shared/componentTypes'
import type { LayerFrame } from '../../src/shared/courseProjectTypes'

const root = resolve(__dirname, '..', '..')
const runRoot = mkdtempSync(join(tmpdir(), 'sample-v9-published-'))
const standalonePath = join(runRoot, 'sample-v9.html')
let controllerItemId = ''
let nextButtonId = ''
let controllerFrame: LayerFrame | null = null
let slideCanvas: { width: number; height: number } | null = null
const PUBLISHED_FRAME_TOLERANCE_CSS_PX = 1

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
  const slide = opened.project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('sample V9 project has no Slide surface')
  controllerItemId = controller.item.layerItemId
  nextButtonId = nextButton.id
  controllerFrame = structuredClone(controller.item.frame)
  slideCanvas = structuredClone(slide.canvas)
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
  if (!controllerFrame || !slideCanvas) throw new Error('sample controller geometry is missing')
  const stage = page.locator('[data-slide-scene-stage="true"]')
  const controllerWrapper = page.locator(`[data-global-layer-item="${controllerItemId}"]`)
  await expect(stage).toBeVisible()
  await expect(controllerWrapper).toBeVisible()
  const [stageBounds, wrapperBounds] = await Promise.all([
    stage.boundingBox(),
    controllerWrapper.boundingBox(),
  ])
  if (!stageBounds || !wrapperBounds) throw new Error('sample Published geometry has no bounds')
  const scaleX = stageBounds.width / slideCanvas.width
  const scaleY = stageBounds.height / slideCanvas.height
  const mapped = {
    left: wrapperBounds.x - stageBounds.x,
    top: wrapperBounds.y - stageBounds.y,
    width: wrapperBounds.width,
    height: wrapperBounds.height,
  }
  const expected = {
    left: controllerFrame.x * scaleX,
    top: controllerFrame.y * scaleY,
    width: controllerFrame.width * scaleX,
    height: controllerFrame.height * scaleY,
  }
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    expect(
      Math.abs(mapped[key] - expected[key]),
      `Published controller ${key} differs from the V9 authored frame`,
    ).toBeLessThanOrEqual(PUBLISHED_FRAME_TOLERANCE_CSS_PX)
  }

  const controller = controllerWrapper.locator('.slide-native-teacher-controller')
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

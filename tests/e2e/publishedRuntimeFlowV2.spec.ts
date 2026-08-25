import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { addCourseFlowPage } from '../../src/renderer/course/courseLocationCommands'
import { selectFlowEditorBlock } from '../../src/renderer/course/flowEditorSlice'
import { insertFlowSharedRuntime } from '../../src/renderer/course/flowSharedAuthoringAdapters'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageFiles,
} from '../../src/renderer/export/course/buildCoursePackages'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseRuntimeDefinition,
} from '../../src/shared/courseProjectTypes'

const root = resolve(__dirname, '..', '..')
const runRoot = mkdtempSync(join(tmpdir(), 'published-runtime-flow-v2-'))
const standalonePath = join(runRoot, 'standalone.html')
const onlineStandalonePath = join(runRoot, 'online-standalone.html')
const webRoot = join(runRoot, 'web')
const NOW = '2026-08-26T01:30:00.000Z'

function clickableRuntime(): CourseRuntimeDefinition {
  return {
    protocol: 'surface-runtime',
    runtimeApiVersion: 3,
    enabled: true,
    renderMode: 'dom',
    source: `
      CoursewareRuntime.define({
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        create(ctx) {
          var count = 0;
          var button = document.createElement('button');
          button.dataset.publishedFlowRuntimeE2eButton = 'true';
          button.textContent = ctx.content.get('label') + ':0';
          Object.assign(button.style, {
            width: '100%', height: '100%', cursor: 'pointer',
            font: 'bold 28px sans-serif'
          });
          var onClick = function () {
            count += 1;
            button.textContent = ctx.content.get('label') + ':' + count;
          };
          button.addEventListener('click', onClick);
          ctx.dom.root.appendChild(button);
          return {
            destroy() {
              button.removeEventListener('click', onClick);
              button.remove();
            }
          };
        }
      });
    `,
    content: { values: { label: 'Flow 真实 Runtime' } },
    assets: {},
  }
}

function passThroughRuntime(): CourseRuntimeDefinition {
  return {
    ...clickableRuntime(),
    source: `
      CoursewareRuntime.define({
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        create(ctx) {
          var marker = document.createElement('div');
          marker.dataset.publishedFlowRuntimeE2ePassThrough = 'true';
          Object.assign(marker.style, { width: '100%', height: '100%' });
          ctx.dom.root.appendChild(marker);
          return { destroy() { marker.remove(); } };
        }
      });
    `,
    content: { values: { label: 'Flow 穿透 Runtime' } },
  }
}

function authorFlowRuntimeFixture(): CourseProjectDocument {
  let project = createBlankCourseProject({ now: NOW })
  const added = addCourseFlowPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  })
  if (!added.ok) throw new Error(added.reason)
  project = added.project
  const location = project.locations.find((candidate) => candidate.kind === 'flow-block')
  if (!location || location.kind !== 'flow-block') throw new Error('expected Flow location')
  const selection = selectFlowEditorBlock(project, location.id, location.blockId)
  const clickable = insertFlowSharedRuntime(project, selection, {
    id: 'published-flow-runtime-e2e',
    label: 'Published Flow Runtime E2E',
    runtime: clickableRuntime(),
  }, { now: NOW })
  if (!clickable.ok || !clickable.nextDocument || !clickable.createdLayerItemIds?.[0]) {
    throw new Error(clickable.reason ?? 'failed to author clickable Flow Runtime')
  }
  const passThrough = insertFlowSharedRuntime(clickable.nextDocument, selection, {
    id: 'published-flow-runtime-e2e-pass-through',
    label: 'Published Flow Runtime E2E Pass Through',
    runtime: passThroughRuntime(),
  }, { now: NOW })
  if (!passThrough.ok || !passThrough.nextDocument || !passThrough.createdLayerItemIds?.[0]) {
    throw new Error(passThrough.reason ?? 'failed to author pass-through Flow Runtime')
  }
  const next = structuredClone(passThrough.nextDocument)
  const flow = next.surfaces.find((surface) => surface.id === location.surfaceId)
  if (!flow || flow.type !== 'flow') throw new Error('expected authored Flow surface')
  const passThroughItem = flow.surfaceLayerItems.find((entry) => (
    entry.item.layerItemId === passThrough.createdLayerItemIds![0]
  ))?.item
  if (!passThroughItem || passThroughItem.kind !== 'runtime') {
    throw new Error('expected pass-through Flow Runtime item')
  }
  passThroughItem.hitPolicy = 'pass-through'
  passThroughItem.order += 1
  next.startLocationId = location.id
  return courseProjectDocumentSchema.parse(next)
}

function writeFixture(): void {
  const sources = {
    project: authorFlowRuntimeFixture(),
    assetFiles: {},
    components: {},
  }
  const playerBundle = readFileSync(join(root, 'dist-player', 'player.iife.js'), 'utf8')
  writeFileSync(
    standalonePath,
    buildPublishedCourseStandaloneHtml(sources, playerBundle),
    'utf8',
  )
  writeFileSync(
    onlineStandalonePath,
    buildPublishedCourseStandaloneHtml(sources, {
      playerBundle,
      singleHtmlMode: 'online-lightweight',
    }),
    'utf8',
  )
  const webFiles = buildPublishedCourseWebPackageFiles(sources, playerBundle)
  for (const [path, bytes] of Object.entries(webFiles)) {
    const target = join(webRoot, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
}

test.beforeAll(() => {
  writeFixture()
})

test.afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true })
})

for (const delivery of [
  { name: '离线便携单 HTML', path: standalonePath, online: false },
  { name: '在线轻量单 HTML', path: onlineStandalonePath, online: true },
  { name: '网页包', path: join(webRoot, 'index.html'), online: false },
] as const) {
  test(`${delivery.name} 用真实指针点击执行 Flow Surface Runtime`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(pathToFileURL(delivery.path).toString())
    const button = page.locator('[data-published-flow-runtime-e2e-button="true"]')
    const passThrough = page.locator('[data-published-flow-runtime-e2e-pass-through="true"]')
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(passThrough).toBeVisible()
    await expect(button).toHaveText('Flow 真实 Runtime:0')
    const clickableWrap = button.locator('xpath=ancestor::*[@data-flow-overlay-item][1]')
    const passThroughWrap = passThrough.locator('xpath=ancestor::*[@data-flow-overlay-item][1]')
    await expect(clickableWrap).toHaveCSS('pointer-events', 'auto')
    await expect(passThroughWrap).toHaveCSS('pointer-events', 'none')
    const topHit = await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      ) === element
    })
    expect(topHit).toBe(true)
    await button.click()
    await expect(button).toHaveText('Flow 真实 Runtime:1')
    if (delivery.online) {
      const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content')
      const scriptPolicy = csp?.match(/script-src[^;]*/)?.[0]
      expect(scriptPolicy).toContain("'unsafe-eval'")
      expect(scriptPolicy).not.toContain('https://')
      expect(scriptPolicy).not.toContain('*')
    }
    expect(errors).toEqual([])
  })
}

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
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageFiles,
} from '../../src/renderer/export/course/buildCoursePackages'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { RuntimeLayerItem } from '../../src/shared/courseProjectTypes'

const root = resolve(__dirname, '..', '..')
const runRoot = mkdtempSync(join(tmpdir(), 'published-runtime-v2-'))
const standalonePath = join(runRoot, 'standalone.html')
const webRoot = join(runRoot, 'web')

function runtimeItem(): RuntimeLayerItem {
  return {
    layerItemId: 'published-runtime-e2e',
    label: 'Published Runtime E2E',
    frame: { mode: 'absolute', x: 320, y: 220, width: 420, height: 180 },
    order: 20_000,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: {
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
            button.dataset.publishedRuntimeE2eButton = 'true';
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
      content: { values: { label: '真实 Runtime' } },
      assets: {},
    },
  }
}

function passThroughRuntimeItem(): RuntimeLayerItem {
  return {
    ...runtimeItem(),
    layerItemId: 'published-runtime-e2e-pass-through',
    label: 'Published Runtime E2E Pass Through',
    order: 21_000,
    hitPolicy: 'pass-through',
    runtime: {
      ...runtimeItem().runtime,
      source: `
        CoursewareRuntime.define({
          protocol: 'surface-runtime',
          runtimeApiVersion: 3,
          create(ctx) {
            var overlay = document.createElement('div');
            overlay.dataset.publishedRuntimeE2ePassThrough = 'true';
            Object.assign(overlay.style, { width: '100%', height: '100%' });
            ctx.dom.root.appendChild(overlay);
            return { destroy() { overlay.remove(); } };
          }
        });
      `,
    },
  }
}

function writeFixture(): void {
  const project = createBlankCourseProject({ now: '2026-08-25T09:30:00.000Z' })
  const next = structuredClone(project)
  const slide = next.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide' || !slide.scenes[0]) {
    throw new Error('expected blank Slide scene')
  }
  slide.scenes[0].layerItems = [runtimeItem(), passThroughRuntimeItem()]
  const sources = {
    project: courseProjectDocumentSchema.parse(next),
    assetFiles: {},
    components: {},
  }
  const playerBundle = readFileSync(join(root, 'dist-player', 'player.iife.js'), 'utf8')
  writeFileSync(
    standalonePath,
    buildPublishedCourseStandaloneHtml(sources, playerBundle),
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
  { name: '单 HTML', path: standalonePath },
  { name: '网页包', path: join(webRoot, 'index.html') },
] as const) {
  test(`${delivery.name} 用真实指针点击执行 Slide Surface Runtime`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(pathToFileURL(delivery.path).toString())
    const button = page.locator('[data-published-runtime-e2e-button="true"]')
    const passThrough = page.locator('[data-published-runtime-e2e-pass-through="true"]')
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(passThrough).toBeVisible()
    await expect(button).toHaveText('真实 Runtime:0')
    const topHit = await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      ) === element
    })
    expect(topHit).toBe(true)
    await button.click()
    await expect(button).toHaveText('真实 Runtime:1')
    expect(errors).toEqual([])
  })
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { transformSync } from 'esbuild'
import { closeNativeEditor, launchNativeEditor, readSaved } from './r18NativeAuthoringFixture'
import { REMAINING_IDS, openSurface } from './r18NativeAuthoringRemainingFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import type { observeRuntimeDomControls } from '../../src/renderer/authoring/generation/runtimeDomControlObservation'

test('reads the actual failed T10 Runtime button through a hidden running host with no click or model call', async () => {
  const lesson = process.env.COURSEWARE_R18_RUNTIME_DOM_LESSON
  test.skip(!lesson, 'Explicit existing failed-T10 lesson required; no fixture is generated or restored')
  test.setTimeout(90000)
  const product = resolve(__dirname, '../..'), projectPath = resolve(lesson!)
  const before = readSaved(projectPath)
  const runRoot = join(product, 'output/r18-runtime-dom-observation', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(runRoot, { recursive: true })
  const helperPath = join(product, 'src/renderer/authoring/generation/runtimeDomControlObservation.ts')
  const helper = transformSync(readFileSync(helperPath, 'utf8'), {
    loader: 'ts', target: 'es2022', format: 'iife', globalName: 'runtimeDomObserver',
  }).code
  const run = await launchNativeEditor(product, runRoot, projectPath)
  try {
    await openSurface(run, 'slide-scene')
    await run.page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    await expect(run.page.getByRole('button', { name: '显示答案', exact: true })).toBeVisible()
    await expect(run.page.getByText('答案尚未显示', { exact: true })).toBeVisible()
    // Evaluate the exact read-only product helper against the actual mounted
    // Runtime. No host or source replacement and no synthetic DOM are installed.
    const facts = await run.page.evaluate<ReturnType<typeof observeRuntimeDomControls>>(`(() => { ${helper}\nreturn runtimeDomObserver.observeRuntimeDomControls(document.body, [{instanceId:${JSON.stringify(REMAINING_IDS.brokenRuntime)},carrier:'runtime'}]); })()`)
    writeFileSync(join(runRoot, 'actual-facts.json'), JSON.stringify(facts, null, 2))
    if (!facts.instances[0]?.controls.length) {
      const diagnostic = await run.page.getByRole('button', { name: '显示答案', exact: true }).evaluate(button => {
        const ancestors = []
        for (let element: Element | null = button; element; element = element.parentElement) {
          const style = getComputedStyle(element), rect = element.getBoundingClientRect()
          ancestors.push({ tag: element.tagName, attributes: [...element.attributes].map(attribute => [attribute.name, attribute.value]),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            style: { display: style.display, visibility: style.visibility, opacity: style.opacity, overflowX: style.overflowX, overflowY: style.overflowY } })
        }
        return ancestors
      })
      writeFileSync(join(runRoot, 'unexpected-empty-controls.json'), JSON.stringify(diagnostic, null, 2))
    }
    expect(facts).toMatchObject({ clickPerformed: false, functionalResult: 'not-tested', instances: [{
      instanceId: REMAINING_IDS.brokenRuntime, controls: [{ label: '显示答案', pointerEvents: 'none', disabled: false,
        centerHit: { status: 'other-element', element: { runtimeLayer: 'phaser' } } }],
    }] })
    await expect(run.page.getByText('答案尚未显示', { exact: true })).toBeVisible()
    await run.page.screenshot({ path: join(runRoot, 'actual-button-observation.png'), animations: 'allow' })
    await expectBackgroundWindowsIsolated(run.app, true)
    expect(run.pageErrors).toEqual([])
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ status: 'passed', projectPath, documentRevision: before.project.revision,
      helperPath, actualHost: 'existing-saved-lesson-trial', helperExecution: 'exact-product-source-read-only-evaluation',
      nativeCalls: 0, controlsClicked: 0, modelRepairVerified: false, facts }, null, 2))
  } finally { await closeNativeEditor(run); expect(readSaved(projectPath)).toEqual(before) }
})

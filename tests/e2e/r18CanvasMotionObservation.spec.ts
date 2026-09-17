import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeNativeEditor, launchNativeEditor, observeRuntimeTiming, readSaved, runtimeItem } from './r18NativeAuthoringFixture'
import { compareCanvasMotion, validateCanvasPoses } from './runtimeCanvasMotionObservation'

test('zero-model actual saved T05 Canvas observer and comparator counterexamples', async () => {
  test.setTimeout(180_000)
  const configuredSourceRoot = process.env.R18_T05_CANVAS_SOURCE_ROOT?.trim()
  test.skip(!configuredSourceRoot,
    '需要通过 R18_T05_CANVAS_SOURCE_ROOT 指定既有真实 T05 制品目录；默认跳过，不代表通过')
  if (!configuredSourceRoot) return
  const sourceRoot = resolve(configuredSourceRoot)
  expect(existsSync(join(sourceRoot, 'T05.h5lesson')),
    'R18_T05_CANVAS_SOURCE_ROOT 必须包含既有真实 T05.h5lesson 制品').toBe(true)
  const productRoot = resolve(__dirname, '../..')
  const output = resolve(productRoot, 'output/r18-development-20260908', `opencode2-canvas-observation-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(output, { recursive: true })
  const projectPath = join(output, 'T05-readonly-copy.h5lesson')
  copyFileSync(join(sourceRoot, 'T05.h5lesson'), projectPath)
  const saved = readSaved(projectPath)
  const run = await launchNativeEditor(productRoot, output, projectPath)
  try {
    const before = await observeRuntimeTiming(run, runtimeItem(saved.project), 'T05-before')
    if (before.source !== 'actual-preview-canvas-painted-quadrilaterals') throw new Error('Actual T05 did not use Canvas observation')
    const first = before.poses[0]!
    const staticPoses = before.poses.map(pose => ({ ...first, at: pose.at }))
    expect(() => validateCanvasPoses(staticPoses)).toThrow(/static/)
    expect(() => compareCanvasMotion(before, before)).toThrow(/not demonstrably slower/)
    // Algorithm-only control: retime already observed geometry, never the app.
    const control = { ...before, poses: before.poses.map(pose => ({ ...pose, at: first.at + (pose.at - first.at) / .6 })) }
    const comparison = compareCanvasMotion(before, control)
    expect(comparison.speedRatio).toBeCloseTo(.6, 5)
    expect(readSaved(projectPath)).toEqual(saved)
    writeFileSync(join(output, 'observer-validation.json'), JSON.stringify({ actualBefore: validateCanvasPoses(before.poses), staticRejected: true, sameSpeedRejected: true,
      algorithmOnlyTimeStretch: comparison, realSlowedRuntimeTested: false, originalProjectAndHistoryUntouched: true, paidCalls: 0 }, null, 2))
    console.log(`Canvas observation artifact: ${output}`)
  } finally { await closeNativeEditor(run) }
})

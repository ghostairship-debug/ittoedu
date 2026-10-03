// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { nativeAuthoringToolInputSchema } from '../../src/renderer/authoring/tools/nativeAuthoringTool'
import { layerEditInputSchema } from '../../src/renderer/authoring/tools/layerEditTool'
import { flowAuthoringToolInputSchema } from '../../src/renderer/authoring/tools/flowAuthoringTool'
import { recipeTool } from '../../src/renderer/authoring/tools/recipeTool'
import { slideStructureToolInputSchema } from '../../src/renderer/authoring/tools/slideStructureTool'
import { fontAssetTool } from '../../src/renderer/authoring/tools/fontAssetTool'
import { inspectProjectFont } from '../../src/shared/fonts/projectFontFile'
import { planProjectFontImport } from '../../src/renderer/course/projectFontImport'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('accepts long supported authoring content and complete batches while preserving type and layout semantics', () => {
  const replacements = Array.from({ length: 101 }, (_, index) => ({ original: `original-${index}`, replacement: `replacement-${index}` }))
  expect(nativeAuthoringToolInputSchema.parse({ operation: 'edit-text', replacements })).toMatchObject({ replacements })
  expect(nativeAuthoringToolInputSchema.parse({ operation: 'edit', replacements })).toMatchObject({ replacements })
  const targets = Array.from({ length: 201 }, (_, index) => ({ projectId: 'fixture', documentRevision: 0,
    revisionPolicy: { kind: 'exact' }, sessionGeneration: 0, surfaceType: 'slide', surfaceId: 'slide', locationId: 'page',
    stateId: null, owner: 'scene', ownerKey: 'scene:page', itemId: `item-${index}`, authoringAddress: `address-${index}` }))
  expect(layerEditInputSchema.parse({ operation: 'align', targets, mode: 'left' })).toMatchObject({ targets })
  expect(layerEditInputSchema.parse({ operation: 'distribute', targets, axis: 'horizontal' })).toMatchObject({ targets })
  const formula = { latex: 'x'.repeat(16385), accessibleText: 'description'.repeat(401) }
  expect(flowAuthoringToolInputSchema.parse({ operation: 'edit', formula })).toMatchObject({ formula })
  const nested = { latex: '{'.repeat(64) + 'x' + '}'.repeat(64), accessibleText: 'Nested x' }
  expect(flowAuthoringToolInputSchema.parse({ operation: 'edit', formula: nested })).toMatchObject({ formula: nested })
  expect(recipeTool.inputSchema.parse({ recipeId: 'cover-v1', slots: { title: 't'.repeat(1201) } })).toMatchObject({ slots: { title: 't'.repeat(1201) } })
  expect(slideStructureToolInputSchema.parse({ operation: 'rename-page', name: 'n'.repeat(121) })).toMatchObject({ name: 'n'.repeat(121) })
  expect(nativeAuthoringToolInputSchema.safeParse({ operation: 'edit-text', replacements: [{ original: 123, replacement: 'bad' }] }).success).toBe(false)
  expect(flowAuthoringToolInputSchema.safeParse({ operation: 'edit', formula: { latex: '\\unknown', accessibleText: 'invalid' } }).success).toBe(false)
  expect(flowAuthoringToolInputSchema.safeParse({ operation: 'edit', lineSpacing: 201 }).success).toBe(false)
})

it('accepts large structurally valid font containers and base64 while rejecting malformed containers and encodings', () => {
  const bytes = new Uint8Array(32 * 1024 * 1024 + 1), view = new DataView(bytes.buffer)
  view.setUint32(0, 0x00010000); view.setUint16(4, 1)
  view.setUint32(12, 0x44415441); view.setUint32(20, 28); view.setUint32(24, bytes.length - 28)
  expect(inspectProjectFont(bytes)).toEqual({ mimeType: 'font/ttf', extension: 'ttf' })
  const encoded = Buffer.from(bytes).toString('base64')
  const accepted = fontAssetTool.inputSchema.parse({ filename: 'f'.repeat(501) + '.ttf', base64: encoded })
  expect(accepted.base64.length).toBe(encoded.length)
  expect(fontAssetTool.inputSchema.safeParse({ filename: 'bad.ttf', base64: 'AA===' }).success).toBe(false)
  expect(fontAssetTool.inputSchema.safeParse({ filename: 'bad.ttf', base64: 'A?==' }).success).toBe(false)
  view.setUint32(24, bytes.length)
  expect(() => inspectProjectFont(bytes)).toThrow('字体表超出文件边界')
  expect(() => inspectProjectFont(new Uint8Array(11))).toThrow('字体文件头不完整')
})

it('waits for actual font decoding beyond five seconds and produces a font import transaction when decoding succeeds', async () => {
  vi.useFakeTimers()
  const bytes = new Uint8Array(readFileSync('node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-latin-wght-normal.woff2'))
  let finish!: () => void, settled = false, decodingStarted = false
  const decoding = new Promise<void>(resolve => { finish = resolve })
  vi.stubGlobal('FontFace', class {
    load() { decodingStarted = true; return decoding.then(() => this) }
  })
  const project = createBlankCourseProject()
  const imported = planProjectFontImport(project, 'lesson.woff2', bytes)
  void imported.then(() => { settled = true }, () => { settled = true })
  expect(decodingStarted).toBe(true)
  await vi.advanceTimersByTimeAsync(6000)
  expect(settled).toBe(false)
  finish()
  const result = await imported
  expect(result.transaction.nextDocument.assets[result.assetId]).toMatchObject({ kind: 'font', byteLength: bytes.length })
  expect(result.transaction.resourceChanges.assetFileChanges?.[0]?.after).toEqual(bytes)
})

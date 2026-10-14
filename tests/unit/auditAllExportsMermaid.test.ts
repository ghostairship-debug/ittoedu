import { expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentDocx, type ComponentCaptureRequest } from '../../src/renderer/export/componentPlatform/document'
import { buildComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { auditExportPng } from '../fixtures/auditExportPng'

function project(sourceBacked = false) {
  return courseProjectV10Schema.parse({ schemaVersion: 10, id: 'mermaid-output', revision: 0, title: '健康正文', assets: {},
    definitions: { block: { id: 'block', role: 'content', ...(sourceBacked ? { professionalBuiltinKey: 'guoling.document-block' } : {}), implementation: sourceBacked
      ? { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' } : { kind: 'builtin', key: 'guoling.document-block' } } },
    instances: { diagram: { id: 'diagram', definitionId: 'block', data: { type: 'code', language: 'mermaid', code: 'flowchart LR\nA[修改] --> B[保存]' } },
      code: { id: 'code', definitionId: 'block', data: { type: 'code', language: 'javascript', code: 'const answer = 42;' } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '健康标题', childIds: ['diagram', 'code'] }], global: { underlay: [], overlay: [] } })
}

it.each([false, true])('Mermaid consumes one existing real capture with sourceBacked=%s while ordinary code stays editable in Word', async sourceBacked => {
  const source = project(sourceBacked), before = structuredClone(source)
  const captureInstance = vi.fn(async (_request: ComponentCaptureRequest) => ({ bytes: auditExportPng(320, 100), mimeType: 'image/png', width: 320, height: 100 }))
  const print = await buildComponentPrintHtml(source, { surfaceId: 'flow', captureInstance })
  const word = await buildComponentDocx(source, { surfaceId: 'flow', captureInstance })
  const diagrams = captureInstance.mock.calls.filter(call => call[0].instanceId === 'diagram')
  expect(diagrams).toHaveLength(2)
  if (!sourceBacked) expect(captureInstance.mock.calls).toHaveLength(2)
  expect(print.html).toContain('data-output-capture="true"'); expect(print.html).not.toContain('flowchart LR')
  const files = unzipSync(word.bytes), body = strFromU8(files['word/document.xml']!)
  expect(body).toContain('<w:drawing>'); expect(body).toContain('const answer = 42;'); expect(body).not.toContain('flowchart LR')
  for (const output of [print, word]) expect(output.diagnostics).toContainEqual(expect.objectContaining({ instanceId: 'diagram', code: 'actual-static-capture' }))
  expect(source).toEqual(before)
})

it.each(['missing', 'failed'] as const)('Mermaid %s capture retains its source and healthy code with the actual local diagnostic', async kind => {
  const captureInstance = async () => { if (kind === 'failed') throw new Error('diagram rendering failed'); return undefined }
  const source = project(), print = await buildComponentPrintHtml(source, { surfaceId: 'flow', captureInstance }),
    word = await buildComponentDocx(source, { surfaceId: 'flow', captureInstance })
  expect(print.html).toContain('flowchart LR'); expect(print.html).toContain('const answer = 42;')
  const body = strFromU8(unzipSync(word.bytes)['word/document.xml']!)
  expect(body).toContain('flowchart LR'); expect(body).toContain('const answer = 42;')
  for (const output of [print, word]) {
    expect(output.fidelity).toBe('partial')
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ instanceId: 'diagram', code: kind === 'failed' ? 'capture-failed' : 'mermaid-capture-missing' }))
    expect(output.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'actual-static-capture' }))
  }
})

// @vitest-environment node
import { expect, it } from 'vitest'
import { modelToolResult } from '../../src/core/tools/modelToolResult'
import type { ContentApplyRequest, ContentApplyResult, ContentApplySource } from '../../src/core/contentApply/planning/types'
import type { ToolResult } from '../../src/shared/workbench/tools'

const secret = 'AUTHOR-CONTENT-DO-NOT-ECHO'
const bytes = new TextEncoder().encode(secret)
function envelope(input: ContentApplyRequest, commit: ContentApplyResult['commit'] = 'committed'): ToolResult {
  return { kind: 'read', data: { path: 'pages/02-实验.html', commit,
    usability: commit === 'unknown' ? 'unverified' : commit === 'not_committed' ? 'unusable' : 'usable',
    delivery: 'not_requested', input, insertedIds: ['new-instance'],
    diagnostics: [{ code: 'repair-here', level: 'warning', message: '保留完整诊断'.repeat(300), repairable: true }],
    nextStep: { tool: 'project.read', path: 'pages/02-实验.html' }, version: 'captured-v1' } }
}

it.each(['committed', 'not_committed', 'unchanged', 'unknown'] as const)(
  'projects HTML input with no receipt for %s, preserving decision facts and raw recoverable input', commit => {
    // T23 committed and T31 not_committed both carried original.bytes in this same HTML shape.
    const raw = envelope({ intent: 'content', target: { kind: 'container', container: { kind: 'surface', surfaceId: 'page-2' } },
      source: { kind: 'html', html: secret, scope: 'projection', themeCss: secret,
        siblingFiles: new Map([['module.js', bytes]]), original: { filename: '实验.html', mimeType: 'text/html', bytes } },
      projection: { html: secret, entries: [{ instanceId: 'old-instance', sourcePath: [0, 1] }] },
      editingContext: { surfaceId: 'page-2', stateId: null }, viewport: { width: 1280, height: 720 } }, commit)
    const before = structuredClone(raw)
    const projected = modelToolResult('project.apply', raw) as Extract<ToolResult, { kind: 'read' }>
    expect(projected.data).toMatchObject({ commit, path: 'pages/02-实验.html', version: 'captured-v1',
      input: { intent: 'content', target: { kind: 'container', container: { kind: 'surface', surfaceId: 'page-2' } },
        source: { kind: 'html', scope: 'projection', themeCssChanged: true, siblingFiles: ['module.js'],
          original: { filename: '实验.html', mimeType: 'text/html' } },
        projection: { entries: [{ instanceId: 'old-instance', sourcePath: [0, 1] }] },
        editingContext: { surfaceId: 'page-2', stateId: null }, viewport: { width: 1280, height: 720 } } })
    const data = projected.data as any, original = (raw as any).data
    for (const key of ['commit', 'usability', 'delivery', 'insertedIds', 'diagnostics', 'nextStep']) expect(data[key]).toEqual(original[key])
    expect(data).not.toHaveProperty('receipt')
    expect(data.input.source).not.toHaveProperty('html')
    expect(data.input.source.original).not.toHaveProperty('bytes')
    expect(data.input.projection).not.toHaveProperty('html')
    expect(JSON.stringify(projected)).not.toContain(secret)
    expect(raw).toEqual(before)
    expect(modelToolResult('project.read', raw)).toBe(raw)
    expect(modelToolResult('file.read', raw)).toBe(raw)
    // Recovery/run JSON represents Maps and Uint8Arrays as plain objects; projection is also safe on that carrier.
    const recovered = JSON.parse(JSON.stringify(raw))
    const recoveredProjection = modelToolResult('project.apply', recovered) as any
    expect(recoveredProjection.data.input.source.original).not.toHaveProperty('bytes')
    expect(recoveredProjection.data.input.source.siblingFiles).toEqual([])
    expect(recovered.data.input.source.original.bytes).toEqual(JSON.parse(JSON.stringify(bytes)))
  })

it('projects canonical edits, source implementations and owner files by their contract', () => {
  const raw = envelope({ intent: 'canonical', edits: [
    { type: 'data.set', instanceId: 'i1', path: ['content', 'html'], value: secret },
    { type: 'component.files.set', ownerId: 'owner', files: { 'main.ts': bytes }, expectedFiles: { 'old.ts': bytes } },
    { type: 'definition.set', definition: { id: 'def', role: 'content', version: 'v3',
      implementation: { kind: 'source', language: 'typescript', source: secret, moduleBindings: { helper: 'dep' } }, dataSchema: { description: secret } } },
    { type: 'implementation.set', instanceId: 'i2', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'owner', entry: 'main.ts' } } },
    { type: 'asset.replace', asset: { id: 'asset', path: 'assets/a.svg', filename: 'a.svg' }, bytes, expectedBytes: bytes },
    { type: 'frame.set', instanceId: 'i1', frame: null },
  ] })
  const projected = modelToolResult('project.apply', raw) as any
  expect(projected.data.input.edits).toEqual([
    { type: 'data.set', instanceId: 'i1', path: ['content', 'html'], fields: ['value'] },
    { type: 'component.files.set', ownerId: 'owner', fields: ['files', 'expectedFiles'], files: ['main.ts'] },
    { type: 'definition.set', fields: ['definition'], definition: { id: 'def', role: 'content', version: 'v3',
      implementation: { kind: 'source', language: 'typescript', moduleBindings: { helper: 'dep' } } } },
    { type: 'implementation.set', instanceId: 'i2', fields: ['implementation'], implementation: {
      kind: 'source', language: 'javascript', workspace: { ownerId: 'owner', entry: 'main.ts' } } },
    { type: 'asset.replace', fields: ['asset', 'bytes', 'expectedBytes'], asset: { id: 'asset', path: 'assets/a.svg', filename: 'a.svg' } },
    { type: 'frame.set', instanceId: 'i1', fields: ['frame'] },
  ])
  expect(JSON.stringify(projected)).not.toContain(secret)
  expect((raw as any).data.input.edits[0].value).toBe(secret)
})

it.each([
  { kind: 'data', fields: [{ path: ['html'], value: secret }], implementation: { kind: 'source', language: 'javascript', source: secret },
    componentFiles: [{ type: 'component.files.set', ownerId: 'owner', files: { 'main.js': bytes }, expectedFiles: null }] },
  { kind: 'objects', objects: [{ definitionId: 'def', data: { html: secret }, style: { css: secret }, children: [{ definitionId: 'child', data: secret }] }],
    definitions: [{ id: 'def', role: 'content', version: 'v1', implementation: { kind: 'source', language: 'javascript', source: secret } }] },
  { kind: 'style', style: { css: secret } },
] satisfies ContentApplySource[])(
  'summarizes authored %j values without arbitrary JSON filtering', source => {
    const raw = envelope({ intent: 'content', target: { kind: 'instance', instanceId: 'i1' }, source })
    const before = structuredClone(raw)
    expect(JSON.stringify(modelToolResult('project.apply', raw))).not.toContain(secret)
    expect(raw).toEqual(before)
  })

it('leaves arbitrary authored reads and non-ContentApply shapes intact', () => {
  const authored: ToolResult = { kind: 'read', data: { commit: 'committed', input: { intent: 'content', source: secret },
    text: secret, receipt: { status: 'applied' } } }
  expect(modelToolResult('project.apply', authored)).toBe(authored)
  expect(modelToolResult('file.read', authored)).toBe(authored)
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createComponentPlatformMixedDeliveryFixture } from '../fixtures/componentPlatformMixedDeliveryFixture'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { useCourseDelivery, type CourseDeliveryPorts } from '../../src/renderer/app/useCourseDelivery'
import { buildDocumentExport } from '../../src/renderer/workbench/delivery/DocumentExportRenderer'
import { buildComponentDelivery } from '../../src/renderer/export/componentPlatform/delivery'
import { publishedCourseV3Schema } from '../../src/shared/contracts/component-platform/published'
import { TextEncoder as NodeTextEncoder } from 'node:util'

// Vitest's jsdom exposes a second Uint8Array realm. Keep esbuild's Node encoding invariant.
globalThis.TextEncoder = class extends NodeTextEncoder { encode(input?: string) { return Uint8Array.from(super.encode(input)) } }

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({ loadPlayerBundle: () => 'var CoursewarePlayer={};' }))
const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
const compile = compilation.compile.bind(compilation)
const payload = (html: string) => publishedCourseV3Schema.parse(JSON.parse(new DOMParser().parseFromString(html, 'text/html').querySelector('#course-data')!.textContent!))

describe('X0/X1 same-snapshot delivery', () => {
  it('projects real multi-file source and both asset policies without changing author data or attribution', async () => {
    const sample = createComponentPlatformMixedDeliveryFixture(), before = structuredClone({ project: sample.project, resources: sample.resources })
    const offline = await buildPublishedCourseV3({ project: sample.project, assetBytes: sample.resources.assets, componentFiles: sample.resources.components }, { compilation })
    const online = await buildPublishedCourseV3({ project: sample.project, assetBytes: {}, componentFiles: sample.resources.components }, { compilation, singleHtmlMode: 'online-lightweight' })
    expect(offline.payload.assets['circuit-image']!.url).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(online.payload.assets['circuit-image']!.url).toBe(sample.project.assets['circuit-image']!.remote!.url)
    expect(online.payload.assets['circuit-image']!.source?.url).toBe('https://mixed-delivery.test/credit')
    expect(online.diagnostics).toEqual([expect.objectContaining({ code: 'online-remote-asset', severity: 'info' })])
    expect(online.offlineComplete).toBe(false)
    const implementation = offline.payload.definitions['mixed-program']!.implementation
    expect(implementation.kind).toBe('source')
    if (implementation.kind !== 'source') throw new Error('fixture implementation')
    expect(implementation.compiled?.code.replace(/\\u([\da-f]{4})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))).toContain('点击切换开关')
    expect(implementation.workspace).toEqual({ ownerId: 'mixed-program', entry: 'main.ts' })
    expect(sample.project).toEqual(before.project)
    for (const [id, bytes] of Object.entries(sample.resources.assets)) expect([...bytes]).toEqual([...before.resources.assets[id]!])
    for (const [owner, files] of Object.entries(sample.resources.components)) for (const [file, bytes] of Object.entries(files))
      expect(new TextDecoder().decode(bytes)).toEqual(new TextDecoder().decode(before.resources.components[owner]![file]!))
  })

  it('carries the selected UI mode through drain, export and Main frozen-request generation', async () => {
    const sample = createComponentPlatformMixedDeliveryFixture(), saved: string[] = []
    const ports: CourseDeliveryPorts = { captureSnapshot: async () => sample.delivery, readCanonicalSnapshot: () => sample.delivery,
      compileComponent: compile, runBusy: async work => work(), commitStatus: vi.fn(), reportError: vi.fn(), navigateFinding: vi.fn(),
      exportHtml: async input => { saved.push(input.html); return { path: 'online.html' } }, exportWebPackage: vi.fn(), exportPdf: vi.fn(), exportBinary: vi.fn() }
    const hook = renderHook(() => useCourseDelivery(ports, { documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null }))
    act(() => hook.result.current.exportCourse('single-html', 'online-lightweight'))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(payload(saved[0]!).assets['circuit-image']!.url).toBe('https://mixed-delivery.test/circuit.svg')
    hook.unmount()
    const identity = { documentId: sample.snapshot.documentId, epoch: sample.snapshot.epoch, revision: sample.snapshot.revision, projectId: sample.project.id }
    const reply = await buildDocumentExport({ requestId: 'online', identity, format: 'html-online', snapshot: sample.snapshot }, undefined, compile)
    expect(reply.status, reply.reason).toBe('generated')
    expect(payload(new TextDecoder().decode(reply.files![0]!.bytes)).assets['circuit-image']!.url).toBe('https://mixed-delivery.test/circuit.svg')
  })

  it('composes adapter-owned PDF fragments and asks for each spatial frame and source group body', async () => {
    const sample = createComponentPlatformMixedDeliveryFixture(), calls: string[] = []
    // This test proves routing/CSS aggregation only. Actual pixels are supplied by E3's carrier observation.
    const image = { dataUrl: 'data:image/png;base64,aW1hZ2U=', width: 1000, height: 700 }
    const result = await buildComponentDelivery(sample.delivery, 'pdf', { compile, createCapture: async () => ({
      async captureSurface(id, frame) { calls.push(`${id}/${frame ?? ''}`); return image },
      async captureInstance(id, instance) { calls.push(`${id}/${instance}`); return image }, dispose() {},
    }) })
    expect(calls).toEqual(['mixed-slide/', 'mixed-flow/flow-program', 'mixed-spatial/circuit-view', 'mixed-spatial/results-view'])
    const html = result.artifacts[0]!.html!
    const dom = new DOMParser().parseFromString(html, 'text/html')
    expect(dom.querySelectorAll('.component-print-fragment')).toHaveLength(3)
    expect(dom.querySelectorAll('[data-component-output="flow-program-child"]')).toHaveLength(1)
    expect(html).toContain('@page'); expect(html).toContain('A4 portrait')
    expect(html).not.toContain('data-output-page="course-output-')
  })
})

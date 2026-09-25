import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { summarizeRelMixedRun } from '../e2e/helpers/g20RelMixedEvidence'

const tool = (name: string, input: object, data?: object, operation?: object) => ({
  call: { name, input }, result: operation ? { kind: 'document-operation', result: operation } : { kind: 'read', data },
})
const image = tool('image.generate', {}, { job: 'image-job', documentId: 'document-a',
  status: 'ready', resources: [{ resourceId: 'image-id', resource: 'image-1' }],
  provenance: { requestedImageModel: 'gpt-image-2', actualImageModels: ['gpt-image-2'],
    endpoint: 'https://chatgpt.com/backend-api/codex/images/generations',
    billing: { kind: 'subscription' }, charge: 'unknown' } })
const media = tool('media.insert', { resource: 'image-1' }, undefined,
  { status: 'applied', documentId: 'document-a' })
const failed = (job: string, path: string) => tool('build.compile', { job, path }, { ok: false, message: 'Unexpected token' })
const fixed = (job: string, path: string) => tool('build.compile', { job, path }, { ok: true })
const ready = (job: string, artifact: string) => tool('build.check', { job }, { job, status: 'ready', artifact })
const imported = (job: string, artifact: string) => tool('build.import', { job, artifact }, undefined,
  { status: 'applied', revision: 4 })

describe('REL-T11 mixed-task receipt correlation', () => {
  it('accepts one repaired job and preserves actual image model array', () => {
    const result = summarizeRelMixedRun({ status: 'completed', tools: [image, media,
      failed('job-a', 'runtime.js'), fixed('job-a', 'runtime.js'), ready('job-a', 'art-a'), imported('job-a', 'art-a')] })
    expect(result).toMatchObject({ imageReady: true, mediaLinked: true, firstPass: false, repairedSuccess: true,
      compile: { failed: true, fixedAfterFailure: true },
      build: { checkReady: true, importAppliedAfterReady: true } })
    expect(result.image?.actualImageModels).toEqual(['gpt-image-2'])
    expect(result.build.receiptSequence.appliedImport).toMatchObject({ job: 'job-a', artifact: 'art-a' })
  })

  it('links a generated image through an applied batch and the reopened slide asset bytes', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const resourceId = `image_${createHash('sha256').update(bytes).digest('hex')}`
    const generated = tool('image.generate', {}, { job: 'image-job', documentId: 'document-a',
      status: 'ready', resources: [{ resourceId, resource: 'generated-handle' }] })
    const batch = tool('batch', { operations: [
      { name: 'text.replace', input: { target: 'text-target', content: 'new' } },
      { name: 'media.insert', input: { target: 'scene-owner', resource: 'generated-handle', properties: {} } },
    ] }, undefined, { status: 'applied', documentId: 'document-a', revision: 2 })
    const archive = { project: { assets: { picture: { id: 'picture', kind: 'image', mimeType: 'image/png',
      byteLength: bytes.length } }, surfaces: [{ type: 'slide', scenes: [{ layerItems: [
      { kind: 'native', content: { nativeType: 'image', data: { assetId: 'picture' } } },
    ] }] }] }, assetFiles: { picture: bytes } } as unknown as Parameters<typeof summarizeRelMixedRun>[1]
    const run = { status: 'completed', tools: [generated, batch] }
    expect(summarizeRelMixedRun(run, archive)).toMatchObject({ mediaLinked: true,
      mediaReceipt: { via: 'same-run-batch', resource: 'generated-handle', revision: 2 },
      projectMedia: [{ assetId: 'picture', resourceId, surfaceIndex: 0, sceneIndex: 0, itemIndex: 0 }] })
    const altered = { ...archive!, assetFiles: { picture: new Uint8Array([...bytes, 4]) } }
    expect(summarizeRelMixedRun(run, altered).mediaLinked).toBe(false)
    const unrelated = { ...archive!, project: { ...archive!.project, assets: { ...archive!.project.assets,
      picture: { ...archive!.project.assets.picture!, byteLength: bytes.length } } },
      assetFiles: { picture: new Uint8Array([...bytes.slice(0, -1), 4]) } }
    expect(summarizeRelMixedRun(run, unrelated).mediaLinked).toBe(false)
    expect(summarizeRelMixedRun({ status: 'completed', tools: [generated,
      tool('batch', { operations: [{ name: 'media.insert', input: { resource: 'generated-handle' } }] },
        undefined, { status: 'rejected', documentId: 'document-a' })] }, archive).mediaLinked).toBe(false)
  })

  it('rejects a stitched success from different jobs, paths or artifacts', () => {
    const stitched = [image, media, failed('job-a', 'runtime.js'),
      fixed('job-b', 'runtime.js'), ready('job-a', 'art-a'), imported('job-a', 'art-a')]
    expect(summarizeRelMixedRun({ status: 'completed', tools: stitched }).repairedSuccess).toBe(false)
    expect(summarizeRelMixedRun({ status: 'completed', tools: [image, media,
      failed('job-a', 'runtime.js'), fixed('job-a', 'other.js'), ready('job-a', 'art-a'), imported('job-a', 'art-a')]
    }).compile.fixedAfterFailure).toBe(false)
    expect(summarizeRelMixedRun({ status: 'completed', tools: [image, media,
      failed('job-a', 'runtime.js'), fixed('job-a', 'runtime.js'), ready('job-a', 'art-a'), imported('job-a', 'art-b')]
    }).build.importAppliedAfterReady).toBe(false)
  })

  it('requires ready after repaired compile and media insertion of the generated resource', () => {
    const result = summarizeRelMixedRun({ status: 'completed', tools: [image,
      tool('media.insert', { resource: 'other' }, undefined, { status: 'applied' }),
      ready('job-a', 'art-a'), failed('job-a', 'runtime.js'), fixed('job-a', 'runtime.js'),
      imported('job-a', 'art-a')] })
    expect(result).toMatchObject({ mediaLinked: false, build: { checkReady: false,
      importAppliedAfterReady: false }, repairedSuccess: false })
  })

  const parent = { runId: 'run-a', input: { conversationId: 'conversation-a' }, status: 'partial',
    tools: [image, failed('old-cancelled-job', 'runtime.js')] }
  const signed: { sourceRunId: string; sourceJobId: string; resourceId: string; documentId: string; resource: string;
    sourceDocumentId?: string; destinationDocumentId?: string } = { sourceRunId: 'run-a', sourceJobId: 'image-job', resourceId: 'image-id',
    documentId: 'document-a', resource: 'new-handle' }
  const child = (mapping: typeof signed[] = [signed], resource = 'new-handle', documentId = 'document-a') => ({
    runId: 'run-b', continuedFrom: 'run-a', input: { conversationId: 'conversation-a' },
    status: 'completed', hostContinuationImages: mapping,
    tools: [tool('media.insert', { resource }, undefined, { status: 'applied', documentId }),
      failed('new-job', 'runtime.js'), fixed('new-job', 'runtime.js'),
      ready('new-job', 'new-artifact'), imported('new-job', 'new-artifact')],
  })

  it('accepts only a host re-signed image handle from an exact ready ancestor resource', () => {
    const result = summarizeRelMixedRun([parent, child()])
    expect(result).toMatchObject({ imageReady: true, mediaLinked: true, firstPass: false,
      repairedSuccess: true, mediaReceipt: { via: 'host-re-signed', sourceRunId: 'run-a',
        sourceJobId: 'image-job', resource: 'new-handle' },
      build: { receiptSequence: { appliedImport: { job: 'new-job', artifact: 'new-artifact' } } } })
  })

  it('links a re-signed image after reopening the same file with a new document identity', () => {
    const reopened = { ...signed, sourceDocumentId: 'document-a', destinationDocumentId: 'document-b', documentId: 'document-b' }
    const result = summarizeRelMixedRun([parent, child([reopened], 'new-handle', 'document-b')])
    expect(result).toMatchObject({ imageReady: true, mediaLinked: true, mediaReceipt: { via: 'host-re-signed' } })
    expect(summarizeRelMixedRun([parent, child([{ ...reopened, sourceDocumentId: 'wrong-source' }],
      'new-handle', 'document-b')])).toMatchObject({ mediaLinked: false })
  })

  it('matches saved image bytes through a host re-signed continuation resource ID', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 4, 5, 6])
    const resourceId = `image_${createHash('sha256').update(bytes).digest('hex')}`
    const parentWithResource = { ...parent, tools: [tool('image.generate', {}, {
      job: 'image-job', documentId: 'document-a', status: 'ready',
      resources: [{ resourceId, resource: 'old-handle' }],
    })] }
    const childWithResource = child([{ ...signed, resourceId }])
    const archive = { project: { assets: { picture: { id: 'picture', kind: 'image',
      mimeType: 'image/png', byteLength: bytes.length } },
    surfaces: [{ type: 'slide', scenes: [{ layerItems: [{ kind: 'native',
      content: { nativeType: 'image', data: { assetId: 'picture' } } }] }] }] },
    assetFiles: { picture: bytes } } as unknown as Parameters<typeof summarizeRelMixedRun>[1]
    expect(summarizeRelMixedRun([parentWithResource, childWithResource], archive)).toMatchObject({
      mediaLinked: true, mediaReceipt: { via: 'host-re-signed', resource: 'new-handle' },
      projectMedia: [{ assetId: 'picture', resourceId }],
    })
    expect(summarizeRelMixedRun([parentWithResource, child([{ ...signed,
      resourceId: 'image_invalid' }])], archive).mediaLinked).toBe(false)
  })

  it('rejects an old handle or a wrong run, image job, resource ID or document', () => {
    expect(summarizeRelMixedRun([parent, child([], 'image-1')]).mediaLinked).toBe(false)
    for (const override of [
      { sourceRunId: 'other-run' }, { sourceJobId: 'other-image-job' },
      { resourceId: 'other-image-id' }, { documentId: 'other-document' },
    ]) expect(summarizeRelMixedRun([parent, child([{ ...signed, ...override }])]).mediaLinked).toBe(false)
    expect(summarizeRelMixedRun([parent, child([signed], 'new-handle', 'other-document')]).mediaLinked).toBe(false)
  })

  it('rejects unrelated continuation runs before correlating receipts', () => {
    expect(() => summarizeRelMixedRun([parent, { ...child(), continuedFrom: 'other-run' }]))
      .toThrow('lineage is unverified')
    expect(() => summarizeRelMixedRun([parent, { ...child(), input: { conversationId: 'other-conversation' } }]))
      .toThrow('lineage is unverified')
    expect(() => summarizeRelMixedRun({ ...child(), tools: [...parent.tools, ...child().tools] }))
      .toThrow('requires separate durable runs')
  })

  it('does not stitch a cancelled ancestor build error to a new job success or old artifact', () => {
    const noNewFailure = { ...child(), tools: [
      tool('media.insert', { resource: 'new-handle' }, undefined, { status: 'applied', documentId: 'document-a' }),
      fixed('new-job', 'runtime.js'), ready('new-job', 'new-artifact'), imported('new-job', 'new-artifact'),
    ] }
    const result = summarizeRelMixedRun([parent, noNewFailure])
    expect(result.compile).toMatchObject({ failed: true, fixedAfterFailure: false })
    expect(result.repairedSuccess).toBe(false)
    const wrongArtifact = { ...child(), tools: [
      tool('media.insert', { resource: 'new-handle' }, undefined, { status: 'applied', documentId: 'document-a' }),
      failed('new-job', 'runtime.js'), fixed('new-job', 'runtime.js'),
      ready('old-cancelled-job', 'old-artifact'), imported('old-cancelled-job', 'old-artifact'),
    ] }
    expect(summarizeRelMixedRun([parent, wrongArtifact]).build.importAppliedAfterReady).toBe(false)
  })

  it('chooses a later complete repair over an earlier incomplete same-job pair', () => {
    const old = { ...parent, tools: [image,
      failed('old-cancelled-job', 'runtime.js'), fixed('old-cancelled-job', 'runtime.js')] }
    const result = summarizeRelMixedRun([old, child()])
    expect(result).toMatchObject({ repairedSuccess: true, compile: { fixedAfterFailure: true },
      build: { checkReady: true, importAppliedAfterReady: true,
        receiptSequence: { failedCompile: { runId: 'run-b', job: 'new-job' },
          fixedCompile: { runId: 'run-b', job: 'new-job' },
          readyCheck: { runId: 'run-b', job: 'new-job', artifact: 'new-artifact' },
          appliedImport: { runId: 'run-b', job: 'new-job', artifact: 'new-artifact' } } } })
  })
})

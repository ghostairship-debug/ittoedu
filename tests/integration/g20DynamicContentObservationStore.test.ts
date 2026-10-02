// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import {
  DynamicContentObservationStore,
  type DynamicContentPublication,
} from '../../src/main/workbench/observation/DynamicContentObservationStore'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const driver = new CourseV9Driver()

function snapshot(name: 'surface-runtime' | 'component'): DocumentSnapshot {
  const model = driver.load(new Uint8Array(readFileSync(`tests/fixtures/course-project-v9/${name}.h5lesson`)))
  if (model.kind !== 'course-v9') throw new Error('course')
  return { documentId: `doc-${name}`, epoch: `epoch-${name}`, revision: model.project.revision,
    binding: { kind: 'untitled', suggestedName: `${name}.h5lesson` }, model,
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}

function publication(doc: DocumentSnapshot, sequence: number, generation: string, targets?: DynamicContentPublication['targets']): DynamicContentPublication {
  return { senderId: 17, documentId: doc.documentId, epoch: doc.epoch, revision: doc.revision,
    locationId: 'location-scene-1', viewGeneration: generation, publicationSeq: sequence, source: 'authoring',
    targets: targets ?? [{ kind: 'runtime.text', source: 'auto', revision: doc.revision,
      locationId: 'location-scene-1', itemId: 'slide-surface-runtime', original: '动态标题', region: 'section>h2', text: '动态标题' }] }
}

const identity = (doc: DocumentSnapshot) => ({ documentId: doc.documentId, epoch: doc.epoch,
  revision: doc.revision, locationId: 'location-scene-1' })

describe('M27-T03 Main M15 target observation cache', () => {
  it('retains metadata-only truncation for its document and removes it on clear or a newer publication', async () => {
    const runtime = snapshot('surface-runtime'), component = snapshot('component')
    const docs = new Map([[runtime.documentId, runtime], [component.documentId, component]])
    const store = new DynamicContentObservationStore(async id => docs.get(id) ?? null)
    const truncated = { ...publication(runtime, 1, 'view-a', []), truncatedItemIds: ['slide-surface-runtime'] }
    expect(await store.publish(truncated)).toBe(true)
    expect(await store.read(identity(runtime))).toEqual({ targets: [], truncatedItemIds: ['slide-surface-runtime'] })
    expect(await store.read(identity(component))).toEqual({ targets: [] })
    expect(await store.publish({ ...truncated, publicationSeq: 2, truncatedItemIds: [] })).toBe(true)
    expect(await store.read(identity(runtime))).toEqual({ targets: [] })
    expect(await store.publish({ ...truncated, publicationSeq: 3 })).toBe(true)
    store.clearDocument(runtime.documentId)
    expect(await store.read(identity(runtime))).toEqual({ targets: [] })
    expect(await store.publish({ ...truncated, publicationSeq: 4 })).toBe(true)
    store.clearSender(17)
    expect(await store.read(identity(runtime))).toEqual({ targets: [] })
  })

  it('takes globally increasing publications, retires old generations, and treats empty hits as revocation', async () => {
    const doc = snapshot('surface-runtime')
    const store = new DynamicContentObservationStore(async () => doc)
    expect(await store.publish(publication(doc, 1, 'view-a'))).toBe(true)
    expect((await store.read(identity(doc))).targets).toHaveLength(1)
    expect(await store.publish(publication(doc, 1, 'view-a', []))).toBe(false)
    expect(await store.publish(publication(doc, 2, 'view-b'))).toBe(true)
    expect(await store.publish(publication(doc, 3, 'view-a'))).toBe(false)
    expect(await store.publish(publication(doc, 4, 'view-b', []))).toBe(true)
    expect((await store.read(identity(doc))).targets).toEqual([])
    expect(await store.publish(publication(doc, 3, 'view-b'))).toBe(false)
  })

  it('rejects late hits after Undo revision, clearDocument, and sender teardown', async () => {
    let doc = snapshot('surface-runtime')
    const store = new DynamicContentObservationStore(async () => doc)
    const initial = doc
    expect(await store.publish(publication(doc, 1, 'view-a'))).toBe(true)
    doc = structuredClone(doc)
    doc.revision += 1
    if (doc.model.kind !== 'course-v9') throw new Error('course')
    doc.model.project.revision += 1
    expect((await store.read(identity(initial))).targets).toEqual([])
    expect(await store.publish(publication(initial, 2, 'view-a'))).toBe(false)
    store.clearDocument(doc.documentId)
    // In-place Runtime updates keep the mounted view generation while formal revision advances.
    expect(await store.publish(publication(doc, 3, 'view-a'))).toBe(true)
    expect(await store.publish(publication(doc, 4, 'view-b'))).toBe(true)
    expect(await store.publish(publication(doc, 5, 'view-a'))).toBe(false)
    expect((await store.read(identity(doc))).targets).toHaveLength(1)
    store.clearSender(17)
    expect((await store.read(identity(doc))).targets).toEqual([])
    expect(await store.publish(publication(doc, 5, 'view-b'))).toBe(false)
  })

  it('keeps documents apart and refuses wrong location, malformed hit, and old generation on a page switch', async () => {
    const runtime = snapshot('surface-runtime'), component = snapshot('component')
    const docs = new Map([[runtime.documentId, runtime], [component.documentId, component]])
    const store = new DynamicContentObservationStore(async id => docs.get(id) ?? null)
    expect(await store.publish(publication(runtime, 1, 'runtime-page'))).toBe(true)
    const componentHit: DynamicContentPublication['targets'] = [{ kind: 'component.text', source: 'auto',
      revision: component.revision, locationId: 'location-scene-1', itemId: 'slide-quiz', original: '请选择答案', text: '请选择答案' }]
    expect(await store.publish({ ...publication(component, 1, 'component-page', componentHit), senderId: 18 })).toBe(true)
    expect((await store.read(identity(runtime))).targets).toMatchObject([{ kind: 'runtime.text' }])
    expect((await store.read(identity(component))).targets).toMatchObject([{ kind: 'component.text' }])
    expect(await store.publish({ ...publication(runtime, 2, 'wrong-page'), locationId: 'missing-location' })).toBe(false)
    expect(await store.publish({ ...publication(runtime, 2, 'bad-hit'), targets: [{ ...componentHit[0]!, locationId: 'other-page' }] })).toBe(false)
    expect(await store.publish(publication(runtime, 2, 'next-page', []))).toBe(true)
    expect(await store.publish(publication(runtime, 3, 'runtime-page'))).toBe(false)
    expect((await store.read(identity(runtime))).targets).toEqual([])
    expect((await store.read(identity(component))).targets).toHaveLength(1)
  })

  it('does not resurrect an in-flight publication after a document clear barrier', async () => {
    const doc = snapshot('surface-runtime')
    let finish!: (snapshot: DocumentSnapshot) => void
    let hold = true
    const store = new DynamicContentObservationStore(() => hold
      ? new Promise(resolve => { finish = resolve }) : Promise.resolve(doc))
    const pending = store.publish(publication(doc, 1, 'old-view'))
    store.clearDocument(doc.documentId)
    hold = false
    finish(doc)
    expect(await pending).toBe(false)
    expect((await store.read(identity(doc))).targets).toEqual([])
  })
})

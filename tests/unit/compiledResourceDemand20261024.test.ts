import { expect, it, vi } from 'vitest'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { mountCompiledCourse } from '../../src/player/componentPlatform/compiledPlayer'
import type { PublishedCourseV4 } from '../../src/shared/contracts/component-platform/published'
import { componentAssetDataUrl } from '../../src/core/publish/componentPlatform/resourceUrl'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { installHtmlFrameAuthoring } from '../../src/shared/html/htmlFrameAuthoring'

it('the real compiled authoring consumer materializes used data URLs without traversing every unused resource', async () => {
  const used = componentAssetDataUrl(new Uint8Array([1, 2, 3]), 'image/png'), unused = componentAssetDataUrl(new Uint8Array([4, 5, 6]), 'image/png')
  const payload: PublishedCourseV4 = {
    schemaVersion: 4, id: 'resource-demand', title: 'Resource demand', rootIds: ['page'], entry: { rootInstanceId: 'page' }, global: { underlay: [], overlay: [] },
    definitions: { page: { id: 'page', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } }, text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
    instances: { page: { id: 'page', definitionId: 'page', data: {}, childIds: ['text'], container: { kind: 'slide', designSize: { width: 800, height: 600 } } }, text: { id: 'text', definitionId: 'text', data: { text: 'image' }, frame: { width: 400, height: 300, transform: [1, 0, 0, 1, 0, 0] } } },
    assets: { used: { id: 'used', mimeType: 'image/png', url: used }, unused: { id: 'unused', mimeType: 'image/png', url: unused } },
  }
  const artifact = await compileCoursePlayback(payload, { document, renderBuiltin: async () => `<img src="${used}"><p>image</p>` })
  const root = document.createElement('main'); document.body.append(root)
  const create = vi.fn(() => `blob:compiled/${create.mock.calls.length}`), revoke = vi.fn(), atob = vi.spyOn(globalThis, 'atob')
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }))
  const prepareAssetBytes = vi.fn(async () => { throw new Error('Static playback must not prepare an opaque resource directory') })
  let player: Awaited<ReturnType<typeof mountCompiledCourse>> | undefined
  try {
    player = await mountCompiledCourse(artifact, root, { keyboardNavigation: false, prepareAssetBytes })
    expect(root.querySelector('img')!.src).toBe('blob:compiled/1')
    expect(create).toHaveBeenCalledTimes(1)
    expect(atob.mock.calls.map(([encoded]) => encoded)).toEqual([used.split(',')[1]])
    expect(prepareAssetBytes).not.toHaveBeenCalled()
  } finally { await player?.dispose(); root.remove(); atob.mockRestore(); vi.unstubAllGlobals() }
  expect(revoke).toHaveBeenCalledTimes(1)
})

it('HTML author aliases wait for packed bootstrap and read its decoded v2 payload without copying the JSON DOM', () => {
  const uri = componentAssetDataUrl(new Uint8Array([9, 8, 7]), 'image/png')
  const element = document.createElement('script'); element.id = 'course-data'; element.type = 'application/json'
  element.textContent = JSON.stringify({ format: 'compiled-course-v2', course: { assets: { image: { url: 'data:image/png;base64,' } } } })
  const pool = document.createElement('script'); pool.id = 'course-resource-pool'; pool.type = 'application/json'; pool.textContent = '{}'
  document.body.append(element, pool)
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document)
  try {
    expect(bridge.resourceReference(uri)).toBeUndefined()
    ;(element as typeof element & { __courseDecodedPayload: unknown }).__courseDecodedPayload = { format: 'compiled-course-v2', course: { assets: { image: { url: uri } } } }
    expect(bridge.resourceReference(uri)).toBe('cw-resource:image')
    expect(bridge.resolveResource('cw-resource:image')).toBe(uri)
    expect(element.textContent).not.toContain(uri)
  } finally { bridge.dispose(); element.remove(); pool.remove() }
})

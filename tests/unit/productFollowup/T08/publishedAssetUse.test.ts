import { afterEach, expect, it, vi } from 'vitest'
import { mountPublishedCourseV3 } from '../../../../src/player/componentPlatform/publishedPlayer'
import type { PublishedCourseV3 } from '../../../../src/shared/contracts/component-platform/published'
import { TEXT_DEFINITION , textDataEdit } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { IMAGE_DEFINITION, createImageData } from '../../../../src/components/image'

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const microtasks = async () => { for (let index = 0; index < 40; index++) await Promise.resolve() }
function payload(): PublishedCourseV3 {
  return { schemaVersion: 3, id: 'actual-asset-use', title: '按实际页面加载',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [IMAGE_DEFINITION.id]: IMAGE_DEFINITION },
    instances: {
      title: { id: 'title', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', createTextComponentData('第一页面可用')).value, frame: { width: 400, height: 100, transform: [1, 0, 0, 1, 0, 0] } },
      photo: { id: 'photo', definitionId: IMAGE_DEFINITION.id, data: createImageData('later', '第二页素材'), frame: { width: 300, height: 200, transform: [1, 0, 0, 1, 0, 0] } },
    }, assets: { later: { id: 'later', mimeType: 'image/png', url: 'https://later.example/image.png' }, unused: { id: 'unused', mimeType: 'image/png', url: 'https://unused.example/image.png' } },
    surfaces: [{ id: 'first', kind: 'slide', title: '第一页', childIds: ['title'] }, { id: 'second', kind: 'slide', title: '第二页', childIds: ['photo'] }],
    global: { underlay: [], overlay: [] } }
}

it('a real Published V3 first page mounts without fetching unused or later-page remote assets', async () => {
  // Only the network is substituted; schema, navigation, model/runtime and text renderer are real.
  const network = vi.fn(async () => { throw new Error('Unrequested network fixture') })
  vi.stubGlobal('fetch', network)
  const root = document.createElement('section'); document.body.append(root)
  const player = await mountPublishedCourseV3(payload(), root)
  try {
    expect(root.textContent).toContain('第一页面可用')
    expect(player.navigation.read().locationId).toBe('first')
    expect(network).not.toHaveBeenCalled()
  } finally { await player.dispose() }
})

it('actual later-page use starts only its asset request and disposal aborts it without late runtime attachment', async () => {
  const signals: AbortSignal[] = []
  const network = vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = options?.signal
    if (signal) { signals.push(signal); signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }) }
    else reject(new Error('Actual asset request has no lifecycle signal'))
  }))
  vi.stubGlobal('fetch', network)
  const root = document.createElement('section'); document.body.append(root)
  const player = await mountPublishedCourseV3(payload(), root)
  try {
    expect(network).not.toHaveBeenCalled()
    const moving = player.go('second')
    await microtasks()
    expect(network.mock.calls.map(call => String(call[0]))).toEqual(['https://later.example/image.png'])
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    await player.dispose()
    expect(signals[0].aborted).toBe(true)
    await moving
    await microtasks()
    expect(root.children).toHaveLength(0)
    expect(await player.go('first')).toBe(false)
  } finally { await player.dispose() }
})

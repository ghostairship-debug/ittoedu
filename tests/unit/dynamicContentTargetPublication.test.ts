import { describe, expect, it } from 'vitest'
import type { ComponentAuthoringImageTarget, ComponentAuthoringTextTarget } from '../../src/shared/componentTypes'
import type { RuntimeAuthoringTarget } from '../../src/shared/runtimeTypes'
import {
  collectDynamicContentTargets,
  DynamicContentTargetPublisher,
  type DynamicContentPublication,
} from '../../src/renderer/ui/workspaces/dynamicContentTargetPublication'

describe('M15 host target publication', () => {
  const runtime = (itemId: string, sceneId = 'scene-a'): RuntimeAuthoringTarget => ({
    targetId: 'host-hit', nodeId: itemId, scope: 'scene', sceneId, kind: 'text', key: '',
    layer: 'overlay', source: 'auto', bounds: { x: 0, y: 0, width: 30, height: 20 },
    lightEdit: { original: '原文', region: 'region-a', text: '现文' },
  })
  const componentText = (itemId: string): ComponentAuthoringTextTarget => ({
    kind: 'component-text', targetId: 'host-text', scope: 'scene', sceneId: 'scene-a', nodeId: itemId,
    componentId: 'component-a', key: '', label: 'text', multiline: false, source: 'auto',
    lightEdit: { original: '旧', region: 'region-b', text: '新' },
    bounds: { x: 0, y: 0, width: 30, height: 20 }, rotation: 0,
  })
  const image = (itemId: string): ComponentAuthoringImageTarget => ({
    kind: 'component-image', targetId: 'host-image', scope: 'scene', sceneId: 'scene-a', nodeId: itemId,
    componentId: 'component-a', assetKey: 'picture', label: '图片', source: 'auto',
    bounds: { x: 0, y: 0, width: 30, height: 20 }, rotation: 0,
  })

  it('publishes only auto hits on current visible canonical Runtime and Component layers', () => {
    const hits = collectDynamicContentTargets({
      revision: 7, locationId: 'location-a', sceneId: 'scene-a',
      layers: [
        { source: 'scene', effectiveVisible: true, item: { kind: 'runtime', layerItemId: 'runtime-a' } },
        { source: 'scene', effectiveVisible: true, item: { kind: 'component', layerItemId: 'component-a' } },
        { source: 'scene', effectiveVisible: false, item: { kind: 'runtime', layerItemId: 'hidden' } },
      ],
      runtime: [runtime('runtime-a'), runtime('runtime-a'), runtime('hidden'), runtime('runtime-a', 'old-scene'),
        { ...runtime('runtime-a'), source: 'registered' }],
      componentText: [componentText('component-a'), componentText('missing')],
      componentImage: [image('component-a'), image('missing')],
      truncatedItemIds: ['runtime-a', 'component-a', 'hidden', 'missing', 'runtime-a'],
    })
    expect(hits.truncatedItemIds).toEqual(['runtime-a', 'component-a'])
    expect(hits.targets).toEqual([
      { kind: 'runtime.text', source: 'auto', revision: 7, locationId: 'location-a',
        itemId: 'runtime-a', original: '原文', region: 'region-a', text: '现文' },
      { kind: 'component.text', source: 'auto', revision: 7, locationId: 'location-a',
        itemId: 'component-a', original: '旧', region: 'region-b', text: '新' },
      { kind: 'component.image', source: 'auto', revision: 7, locationId: 'location-a',
        itemId: 'component-a', assetKey: 'picture' },
    ])
  })

  it('publishes truncation changes even when the retained targets stay the same', async () => {
    const sent: DynamicContentPublication[] = []
    const publisher = new DynamicContentTargetPublisher(async value => { sent.push(value) })
    const value = { documentId: 'document-a', epoch: 'epoch-a', revision: 7, locationId: 'location-a',
      viewGeneration: 'host-a', source: 'authoring' as const,
      targets: [{ kind: 'runtime.text' as const, source: 'auto' as const, revision: 7,
        locationId: 'location-a', itemId: 'runtime-a', original: '原文', text: '现文' }] }
    publisher.replace(value)
    publisher.replace({ ...value, truncatedItemIds: ['runtime-a'] })
    publisher.replace({ ...value, truncatedItemIds: [] })
    await publisher.settled()
    expect(sent.map(item => item.truncatedItemIds ?? [])).toEqual([[], ['runtime-a'], []])
    expect(sent.every(item => item.targets.length === 1)).toBe(true)
    publisher.dispose()
    await publisher.settled()
  })

  it('publishes metadata-only discoveries and clears their truncation notice', async () => {
    const sent: DynamicContentPublication[] = []
    const publisher = new DynamicContentTargetPublisher(async value => { sent.push(value) })
    const value = { documentId: 'document-a', epoch: 'epoch-a', revision: 7, locationId: 'location-a',
      viewGeneration: 'host-a', source: 'live' as const, targets: [], truncatedItemIds: ['runtime-a'] }
    publisher.replace(value)
    publisher.replace(value)
    publisher.replace({ ...value, truncatedItemIds: [] })
    await publisher.settled()
    expect(sent.map(item => ({ targets: item.targets, truncatedItemIds: item.truncatedItemIds }))).toEqual([
      { targets: [], truncatedItemIds: ['runtime-a'] },
      { targets: [], truncatedItemIds: [] },
    ])
    publisher.dispose()
    await publisher.settled()
  })

  it('sends clear without waiting for a stuck old publish, with monotonic sequence for Main', async () => {
    const sent: DynamicContentPublication[] = []
    let releaseFirst!: () => void
    const first = new Promise<void>(resolve => { releaseFirst = resolve })
    const publisher = new DynamicContentTargetPublisher(async value => {
      if (value.viewGeneration === 'host-old' && value.targets.length > 0) await first
      sent.push(value)
    })
    const base = { documentId: 'document-a', epoch: 'epoch-a', revision: 7, locationId: 'location-a',
      source: 'authoring' as const }
    const hit = { kind: 'runtime.text' as const, source: 'auto' as const, revision: 7,
      locationId: 'location-a', itemId: 'runtime-a', original: '原文', text: '现文' }
    publisher.replace({ ...base, viewGeneration: 'host-old', targets: [hit] })
    publisher.replace({ ...base, viewGeneration: 'host-new', targets: [hit] })
    publisher.dispose()
    await Promise.resolve(); await Promise.resolve()
    expect(sent.map(value => [value.viewGeneration, value.targets.length])).toEqual([
      ['host-old', 0], ['host-new', 1], ['host-new', 0],
    ])
    releaseFirst()
    await publisher.settled()
    expect(sent.at(-1)).toMatchObject({ viewGeneration: 'host-old', targets: [hit] })
    const bySequence = [...sent].sort((a, b) => a.publicationSeq - b.publicationSeq)
    expect(bySequence.map(value => [value.viewGeneration, value.targets.length])).toEqual([
      ['host-old', 1], ['host-old', 0], ['host-new', 1], ['host-new', 0],
    ])
    expect(new Set(sent.map(value => value.publicationSeq)).size).toBe(sent.length)
  })
})

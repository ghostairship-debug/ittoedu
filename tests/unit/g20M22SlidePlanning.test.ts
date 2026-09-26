import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { planSlideAudioPlacement, planSlideLightOpacity, planSlideLightTextStyle, planSlidePageAlignment, planSlideSceneBackground, planSimpleSlideInteraction, readSimpleSlideInteraction } from '../../src/core/tools/lightSlideEditing'
import { planSlideTextInsertion } from '../../src/core/tools/slideInsertion'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'

function fixture() {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none', canvas: { width: 720, height: 1280 } })
  const locationId = project.locations[0].id
  const added = planSlideTextInsertion(project, { scope: 'scene', selection: { locationId, stateId: null } }, { id: 'button-one', text: '按钮', x: 100, y: 150 })
  const target = { locationId, itemId: added.itemId, expectedRevision: added.project.revision }
  return { project: added.project, target }
}
function scene(project: CourseProjectDocument) { const slide = project.surfaces.find(surface => surface.type === 'slide'); if (!slide || slide.type !== 'slide') throw new Error('missing slide'); return slide.scenes[0] }

describe('M22 Slide light planner', () => {
  it('aligns a rotated item against its actual portrait canvas and keeps frame size', () => {
    const { project, target } = fixture()
    const source = scene(project).layerItems[0]
    source.rotation = 90
    const next = planSlidePageAlignment(project, target, 'right')
    const item = scene(next).layerItems[0]
    expect(item.frame.x).toBe(480)
    expect(item.frame.y).toBe(150)
    expect(item.frame.width).toBe(source.frame.width)
    expect(item.rotation).toBe(90)
    expect(next.revision).toBe(project.revision + 1)
  })

  it('keeps named-state overrides and uses extra pixel spacing', () => {
    const { project, target } = fixture()
    const withState = { ...target, stateId: 'state_initial' }
    const opacity = planSlideLightOpacity(project, withState, 0.5)
    expect(scene(opacity).layerItems[0].opacity).toBe(1)
    expect(scene(opacity).presentation?.states[0].layerItemOverrides[target.itemId].opacity).toBe(0.5)
    const styled = planSlideLightTextStyle(opacity, { ...withState, expectedRevision: opacity.revision }, { lineSpacing: 8 })
    expect(scene(styled).presentation?.states[0].layerItemOverrides[target.itemId].nativeData?.style).toMatchObject({ lineSpacing: 8 })
    expect(() => planSlideLightTextStyle(project, target, { lineSpacing: 1.5 as 0 })).toThrow('额外像素')
  })

  it('sets scene own background, clears its image, and leaves state override untouched', () => {
    const { project, target } = fixture()
    scene(project).backgroundMode = 'inherit'
    const next = planSlideSceneBackground(project, target.locationId, 'state_initial', '#ABCDEF', project.revision)
    expect(scene(next).backgroundMode).toBe('own')
    expect(scene(next).backgroundColor).toBe('#abcdef')
    expect(scene(next).backgroundAssetId).toBeNull()
    expect(scene(next).presentation?.states[0].backgroundColor).toBeUndefined()
    expect(() => planSlideSceneBackground(next, target.locationId, 'state_initial', '#ffffff', project.revision)).toThrow('stale')
  })

  it('updates one simple location rule without changing its identity or another rule', () => {
    const { project, target } = fixture()
    const destinations = [{ ...project.locations[0], id: 'loc-two', label: '重名页' }, { ...project.locations[0], id: 'loc-three', label: '重名页' }]
    project.locations.push(...destinations)
    const first = planSimpleSlideInteraction(project, target, 'location.go', 'loc-two', { ruleId: 'rule-go', stepId: 'step-go' })
    const second = planSimpleSlideInteraction(first, { ...target, expectedRevision: first.revision }, 'location.go', 'loc-three', { ruleId: 'unused', stepId: 'unused' })
    expect(scene(second).interactions).toHaveLength(1)
    expect(scene(second).interactions[0].id).toBe('rule-go')
    expect(scene(second).interactions[0].actions[0].id).toBe('step-go')
    expect(scene(second).interactions[0].actions[0].action).toEqual({ type: 'location.go', locationId: 'loc-three' })
    expect(() => planSimpleSlideInteraction(second, { ...target, expectedRevision: second.revision }, 'location.go', 'missing', { ruleId: 'x', stepId: 'y' })).toThrow('目标页面')
  })

  it('refuses a matching global click rule instead of adding a second scene rule', () => {
    const { project, target } = fixture()
    project.globalInteractions.push({ id: 'global-go', enabled: true, trigger: { type: 'node.click', nodeId: target.itemId }, conditions: [], actions: [{ id: 'global-step', start: 'after-previous', delayMs: 0, action: { type: 'location.go', locationId: target.locationId } }] })
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    expect(readSimpleSlideInteraction(project, target, 'location.go').disabledReason).toContain('全局点击互动')
    expect(() => planSimpleSlideInteraction(project, target, 'location.go', target.locationId, { ruleId: 'scene-go', stepId: 'scene-step' })).toThrow('全局点击互动')
    expect(scene(project).interactions).toHaveLength(0)
    expect(project.globalInteractions).toHaveLength(1)
  })

  it('preserves authored audio parameters when changing only the sound', () => {
    const { project, target } = fixture()
    const asset = { id: 'audio-asset', filename: 'clip.wav', mimeType: 'audio/wav', kind: 'audio' as const, path: 'assets/audio-asset.wav', byteLength: 3 }
    const placed = planSlideAudioPlacement(project, { locationId: target.locationId, expectedRevision: project.revision, asset, bytes: new Uint8Array([1, 2, 3]), buttonId: 'audio-button', ruleId: 'audio-rule', stepId: 'audio-step' })
    const soundId = placed.soundId
    placed.project.media.audio.sounds['second-sound'] = { ...placed.project.media.audio.sounds[soundId], id: 'second-sound' }
    const original = scene(placed.project).interactions[0]
    original.actions[0].action = { type: 'audio.play', soundId, volume: 0.3, fadeInMs: 450, loop: true, lifetime: 'course', ifPlaying: 'continue' }
    const next = planSimpleSlideInteraction(placed.project, { locationId: target.locationId, itemId: 'audio-button', expectedRevision: placed.project.revision }, 'audio.play', 'second-sound', { ruleId: 'unused', stepId: 'unused' })
    expect(scene(next).interactions).toHaveLength(1)
    expect(scene(next).interactions[0].actions[0].action).toEqual({ type: 'audio.play', soundId: 'second-sound', volume: 0.3, fadeInMs: 450, loop: true, lifetime: 'course', ifPlaying: 'continue' })
    expect(scene(next).interactions[0].id).toBe('audio-rule')
  })

  it('reactivates a simple disabled rule when the user selects a destination', () => {
    const { project, target } = fixture()
    const first = planSimpleSlideInteraction(project, target, 'location.go', target.locationId, { ruleId: 'rule-go', stepId: 'step-go' })
    scene(first).interactions[0].enabled = false
    const next = planSimpleSlideInteraction(first, { ...target, expectedRevision: first.revision }, 'location.go', target.locationId, { ruleId: 'unused', stepId: 'unused' })
    expect(scene(next).interactions[0].enabled).toBe(true)
    expect(scene(next).interactions).toHaveLength(1)
  })

  it('refuses complex rules, locked items and stale targets without changing input', () => {
    const { project, target } = fixture()
    scene(project).interactions.push({ id: 'complex', enabled: true, trigger: { type: 'node.click', nodeId: target.itemId }, conditions: [{ type: 'scene.in', sceneIds: [scene(project).id] }], actions: [{ id: 'a', start: 'after-previous', delayMs: 0, action: { type: 'location.go', locationId: target.locationId } }] })
    expect(readSimpleSlideInteraction(project, target, 'location.go').disabledReason).toContain('复杂互动')
    expect(() => planSimpleSlideInteraction(project, target, 'location.go', target.locationId, { ruleId: 'new', stepId: 'new' })).toThrow('复杂互动')
    scene(project).layerItems[0].locked = true
    expect(() => planSlideLightOpacity(project, target, 0.5)).toThrow('锁定')
    expect(() => planSlideLightOpacity(project, { ...target, expectedRevision: -1 }, 0.5)).toThrow('stale')
    expect(project.revision).toBe(target.expectedRevision)
  })

  it('places a sound, button and click rule in one revision even when asset already exists', () => {
    const { project, target } = fixture()
    const asset = { id: 'asset-a', filename: 'hello.wav', mimeType: 'audio/wav', kind: 'audio' as const, path: 'assets/asset-a.wav', byteLength: 3 }
    const first = planSlideAudioPlacement(project, { locationId: target.locationId, expectedRevision: project.revision, asset, bytes: new Uint8Array([1, 2, 3]), buttonId: 'audio-one', ruleId: 'rule-one', stepId: 'step-one' })
    expect(first.project.revision).toBe(project.revision + 1)
    expect(first.assetAddition?.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(scene(first.project).interactions[0].actions[0].action).toMatchObject({ type: 'audio.play', soundId: first.soundId, ifPlaying: 'restart', lifetime: 'scene' })
    const second = planSlideAudioPlacement(first.project, { locationId: target.locationId, expectedRevision: first.project.revision, asset, buttonId: 'audio-two', ruleId: 'rule-two', stepId: 'step-two' })
    expect(second.assetAddition).toBeNull()
    expect(second.soundId).toBe(first.soundId)
    expect(scene(second.project).layerItems.map(item => item.layerItemId)).toContain('audio-two')
    expect(scene(second.project).interactions).toHaveLength(2)
    expect(() => planSlideAudioPlacement(project, { locationId: target.locationId, expectedRevision: project.revision, asset, buttonId: 'x', ruleId: 'y', stepId: 'z' })).toThrow('字节')
  })
})

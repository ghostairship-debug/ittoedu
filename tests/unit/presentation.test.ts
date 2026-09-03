import { describe, expect, it } from 'vitest'
import {
  applySceneNodeOverride,
  createDefaultScenePresentation,
  deriveSceneNodeOverride,
  ensureScenePresentation,
  materializeScene,
  resolveSceneEntryStateId,
  rewritePresentationNodeIds,
  stateReferencesAsset,
} from '@/shared/presentation'
import type { SceneDocument } from '@/shared/projectTypes'
import {
  createExternalComponentNode,
  createRectangleNode,
  createTextNode,
} from '@/renderer/project/nativeNodeFactories'

function blankScene(): SceneDocument {
  return {
    id: 'scene_1',
    name: '场景 1',
    backgroundColor: '#ffffff',
    backgroundAssetId: null,
    nodes: [],
    presentation: createDefaultScenePresentation(),
    interactions: [],
  }
}

describe('scene presentation materialization', () => {
  it('resolves valid entry states and safely falls back without materializing base', () => {
    const scene = blankScene()
    scene.presentation = {
      initialStateId: 'question',
      states: [
        { id: 'question', name: '题目', nodeOverrides: {} },
        { id: 'result', name: '结果', nodeOverrides: {} },
      ],
    }

    expect(resolveSceneEntryStateId(scene, 'result')).toBe('result')
    expect(resolveSceneEntryStateId(scene, 'missing')).toBe('question')
    expect(resolveSceneEntryStateId(scene)).toBe('question')
  })

  it('deep-merges state fields and derives a minimal reversible override', () => {
    const base = createTextNode({
      id: 'title',
      text: '基础标题',
      x: 40,
      style: { color: '#111827', fontSize: 40 },
    })
    const effective = applySceneNodeOverride(base, {
      x: 320,
      text: '答错提示',
      style: { color: '#ef4444' },
    })

    expect(effective).toMatchObject({
      id: 'title',
      type: 'text',
      x: 320,
      text: '答错提示',
      style: { color: '#ef4444', fontSize: 40 },
    })
    const override = deriveSceneNodeOverride(base, effective)
    expect(override).toEqual({
      x: 320,
      text: '答错提示',
      style: { color: '#ef4444' },
    })
    expect(applySceneNodeOverride(base, override)).toEqual(effective)
  })

  it('keeps playback initial hiding separate from stable state visibility', () => {
    const base = createRectangleNode({
      id: 'feedback',
      visible: false,
      playbackInitialVisibility: 'hidden',
    })
    const effective = applySceneNodeOverride(base, { visible: true })

    expect(base).toMatchObject({
      visible: false,
      playbackInitialVisibility: 'hidden',
    })
    expect(effective).toMatchObject({
      visible: true,
      playbackInitialVisibility: 'hidden',
    })
    expect(deriveSceneNodeOverride(base, effective)).toEqual({ visible: true })

    const scene = blankScene()
    scene.nodes = [base]
    scene.presentation!.states[0]!.nodeOverrides[base.id] = { visible: true }
    expect(materializeScene(scene).nodes[0]).toMatchObject({
      visible: true,
      playbackInitialVisibility: 'hidden',
    })
  })

  it('materializes initial and explicit states without mutating the base scene', () => {
    const scene = blankScene()
    const node = createTextNode({ id: 'title', text: '基础', x: 20 })
    scene.nodes.push(node)
    scene.presentation = {
      initialStateId: 'question',
      thumbnailStateId: 'correct',
      states: [
        {
          id: 'question',
          name: '题目',
          nodeOverrides: { title: { text: '请选择答案' } },
        },
        {
          id: 'correct',
          name: '正确',
          backgroundColor: '#ecfdf5',
          nodeOverrides: { title: { text: '回答正确', x: 500 } },
        },
      ],
    }

    expect(materializeScene(scene).nodes[0]).toMatchObject({ text: '请选择答案', x: 20 })
    expect(materializeScene(scene, 'correct')).toMatchObject({
      backgroundColor: '#ecfdf5',
      nodes: [{ text: '回答正确', x: 500 }],
    })
    expect(scene.nodes[0]).toMatchObject({ text: '基础', x: 20 })
  })

  it('uses the initial state when the optional thumbnail state is absent or invalid', () => {
    const scene = blankScene()
    scene.presentation = {
      initialStateId: 'correct',
      states: [
        { id: 'question', name: '题目', nodeOverrides: {} },
        { id: 'correct', name: '正确', nodeOverrides: {} },
      ],
    }

    expect(ensureScenePresentation(scene).thumbnailStateId).toBe('correct')
    scene.presentation.thumbnailStateId = 'missing'
    expect(ensureScenePresentation(scene).thumbnailStateId).toBe('correct')
  })

  it('keeps component package identity out of authored state diffs', () => {
    const base = createExternalComponentNode({
      id: 'quiz',
      name: '互动题',
      component: { packageId: 'com.example.quiz', version: '1.0.0' },
      props: { content: { title: '基础题目' } },
      x: 100,
    })
    const effective = {
      ...structuredClone(base),
      x: 300,
      component: { packageId: 'malicious.swap', version: '9.9.9' },
      props: { content: { title: '状态题目' }, mode: 'result' },
    }

    const override = deriveSceneNodeOverride(base, effective)
    expect(override).toEqual({
      x: 300,
      props: { content: { title: '状态题目' }, mode: 'result' },
    })
    expect(applySceneNodeOverride(base, {
      ...override,
      component: effective.component,
    } as never)).toMatchObject({
      type: 'external-component',
      component: base.component,
    })

    const unsafeProps = JSON.parse(
      '{"__proto__":{"polluted":true}}',
    ) as Record<string, unknown>
    const applied = applySceneNodeOverride(base, {
      props: unsafeProps,
    })
    expect(applied).toMatchObject({ type: 'external-component' })
    if (applied.type !== 'external-component') throw new Error('组件类型丢失')
    expect(Object.getPrototypeOf(applied.props)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(applied.props, '__proto__')).toBe(true)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('applies partial node order deterministically and rewrites it with override ids', () => {
    const scene = blankScene()
    scene.nodes = [
      createTextNode({ id: 'a' }),
      createRectangleNode({ id: 'b' }),
      createTextNode({ id: 'c' }),
    ]
    scene.presentation = {
      initialStateId: 'ordered',
      states: [{
        id: 'ordered',
        name: '排序',
        nodeOverrides: { a: { x: 99 } },
        nodeOrder: ['c', 'a'],
      }],
    }

    expect(materializeScene(scene).nodes.map((node) => node.id)).toEqual([
      'c',
      'a',
      'b',
    ])
    expect(scene.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c'])

    const rewritten = rewritePresentationNodeIds(
      scene.presentation,
      new Map([['a', 'a2'], ['b', 'b2'], ['c', 'c2']]),
    )
    expect(rewritten.states[0]).toMatchObject({
      nodeOverrides: { a2: { x: 99 } },
      nodeOrder: ['c2', 'a2'],
    })
  })

  it('detects state-level background and image asset references', () => {
    expect(stateReferencesAsset({
      id: 'result',
      name: '结果',
      backgroundAssetId: 'background',
      nodeOverrides: { image: { assetId: 'answer-image' } },
    }, 'background')).toBe(true)
    expect(stateReferencesAsset({
      id: 'result',
      name: '结果',
      nodeOverrides: { image: { assetId: 'answer-image' } },
    }, 'answer-image')).toBe(true)
  })
})

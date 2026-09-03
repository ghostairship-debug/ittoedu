import { describe, expect, it } from 'vitest'
import { analyzeVisualDensityState } from '../../src/shared/visualDensity'
import { createTextNode } from '../../src/renderer/project/nativeNodeFactories'

const canvas = { width: 1280, height: 720 }

describe('visual density overview', () => {
  it('reports visible copy, occupied area and substantial overlap per state', () => {
    const state = analyzeVisualDensityState({
      sceneId: 'scene',
      sceneName: '场景 1',
      stateId: 'state_initial',
      stateName: '初始',
      canvas,
      nodes: [
        createTextNode({ id: 'a', x: 0, y: 0, width: 640, height: 360, text: '甲'.repeat(120) }),
        createTextNode({ id: 'b', x: 100, y: 100, width: 640, height: 360, text: '乙'.repeat(120) }),
        createTextNode({ id: 'hidden', visible: false, text: '不计入' }),
      ],
    })
    expect(state).toMatchObject({
      visibleNodeCount: 2,
      textCharacterCount: 240,
      significantOverlapPairs: 1,
    })
    expect(state.occupiedAreaRatio).toBeCloseTo(0.5, 5)
    expect(state.score).toBeGreaterThan(0)
  })

  it('labels a deliberately overloaded state as a heuristic, not an error', () => {
    const state = analyzeVisualDensityState({
      sceneId: 'scene',
      sceneName: '场景 1',
      stateId: 'state_initial',
      stateName: '初始',
      canvas,
      nodes: Array.from({ length: 30 }, (_, index) => createTextNode({
        id: `node-${index}`,
        x: (index % 6) * 190,
        y: Math.floor(index / 6) * 130,
        width: 240,
        height: 160,
        text: '信息'.repeat(20),
      })),
    })
    expect(state.band).toBe('dense')
  })
})

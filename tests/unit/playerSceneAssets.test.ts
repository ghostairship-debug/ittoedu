import { describe, expect, it } from 'vitest'
import { sceneNativeAssetIds } from '@/player/sceneAssets'
import type { NativeRenderInput } from '@/shared/contracts/native-v1/types'

function imageNode(
  id: string,
  assetId: string,
): NativeRenderInput {
  return {
    id,
    name: id,
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    playbackInitialVisibility: 'inherit',
    locked: false,
    assetId,
    preserveAspectRatio: true,
    fit: 'contain',
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    cropX: 0.5,
    cropY: 0.5,
    flipX: false,
    flipY: false,
    cornerRadius: 0,
    feather: { amount: 0, mode: 'rectangle' },
    safeAreas: [],
  }
}

describe('PlayerScene scene-level asset planning', () => {
  it('collects only native images referenced by the requested scene', () => {
    expect(sceneNativeAssetIds({
      backgroundAssetId: 'background',
      nodes: [imageNode('image-1', 'shared-image')],
    })).toEqual(['background', 'shared-image'])
  })

  it('preloads native images reachable only through presentation states', () => {
    expect(sceneNativeAssetIds({
      backgroundAssetId: 'base-background',
      nodes: [imageNode('image-1', 'base-image')],
      namedStates: [
        {
          backgroundAssetId: 'base-background',
          nodes: [imageNode('image-1', 'base-image')],
        },
        {
          backgroundAssetId: 'result-background',
          nodes: [imageNode('image-1', 'result-image')],
        },
      ],
    })).toEqual([
      'base-background',
      'base-image',
      'result-background',
      'result-image',
    ])
  })
})

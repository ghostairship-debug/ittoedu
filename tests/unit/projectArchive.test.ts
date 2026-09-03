import { describe, expect, it, vi } from 'vitest'
import {
  createRectangleNode,
  createTextNode,
} from '@/renderer/project/nativeNodeFactories'
import { BlobUrlRegistry } from '@/renderer/project/blobUrlRegistry'
import {
  createImageAssetImport,
  createRuntimeAssetMap,
  fitImageSize,
} from '@/renderer/project/assetManager'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'

function v9AssetProject() {
  const project = createBlankCourseProject({
    includeDefaultController: false,
    controls: 'none',
  })
  const imageBytes = new Uint8Array([137, 80, 78, 71, 0, 255, 128])
  project.assets.asset_image = {
    id: 'asset_image',
    filename: '课堂图片.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/asset_image.png',
    byteLength: imageBytes.byteLength,
    width: 800,
    height: 450,
  }
  return {
    project,
    assetFiles: { asset_image: imageBytes },
  }
}

describe('project factories', () => {
  it('creates isolated node values without a V8 project document', () => {
    const text = createTextNode({ id: 'text_1' })
    const rectangle = createRectangleNode({ id: 'rectangle_1' })
    expect(text.style).toEqual({
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: 42,
      color: '#1f2937',
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      emphasis: false,
      highlightColor: null,
      align: 'left',
      verticalAlign: 'top',
      writingMode: 'horizontal',
      lineSpacing: 6,
      letterSpacing: 0,
      padding: 0,
      overflow: 'auto-height',
      backgroundColor: '#ffffff',
      backgroundOpacity: 0,
      cornerRadius: 0,
    })
    expect(rectangle).toMatchObject({ type: 'shape', shapeType: 'rectangle' })
    expect(text.playbackInitialVisibility).toBe('inherit')
    expect(rectangle.playbackInitialVisibility).toBe('inherit')
  })
})

describe('asset helpers and BlobUrlRegistry', () => {
  it('sanitises the source name, copies bytes, and derives a portable asset path', () => {
    const sourceBytes = new Uint8Array([1, 2, 3])
    const imported = createImageAssetImport(
      {
        name: 'C:\\Users\\Teacher\\photo.JPEG',
        mimeType: 'image/jpeg',
        bytes: sourceBytes,
      },
      {
        id: 'asset_photo',
        dimensions: { width: 1920, height: 1080 },
      },
    )
    sourceBytes[0] = 99

    expect(imported.meta).toEqual({
      id: 'asset_photo',
      filename: 'photo.JPEG',
      mimeType: 'image/jpeg',
      kind: 'image',
      path: 'assets/asset_photo.jpg',
      byteLength: 3,
      width: 1920,
      height: 1080,
    })
    expect([...imported.bytes]).toEqual([1, 2, 3])
    expect(fitImageSize({ width: 1920, height: 1080 })).toEqual({
      width: 640,
      height: 360,
    })
  })

  it('revokes replaced and disposed Blob URLs exactly once', () => {
    let sequence = 0
    const revokeObjectURL = vi.fn()
    const registry = new BlobUrlRegistry({
      createObjectURL: () => `blob:test-${++sequence}`,
      revokeObjectURL,
    })

    expect(registry.create('asset:a', new Uint8Array([1]), 'image/png')).toBe(
      'blob:test-1',
    )
    expect(registry.create('asset:a', new Uint8Array([2]), 'image/png')).toBe(
      'blob:test-2',
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-1')
    expect(registry.size).toBe(1)
    registry.dispose()
    registry.dispose()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:test-2')
  })

  it('hydrates runtime assets without sharing mutable binary buffers', () => {
    let sequence = 0
    const registry = new BlobUrlRegistry({
      createObjectURL: () => `blob:asset-${++sequence}`,
      revokeObjectURL: vi.fn(),
    })
    const source = v9AssetProject()
    const runtimeAssets = createRuntimeAssetMap(
      source.project,
      source.assetFiles,
      registry,
    )
    source.assetFiles.asset_image[0] = 0

    expect(runtimeAssets.asset_image?.url).toBe('blob:asset-1')
    expect(runtimeAssets.asset_image?.bytes[0]).toBe(137)
  })

  it('gives a Chinese error for unsupported image types', () => {
    expect(() =>
      createImageAssetImport({
        name: 'lesson.bmp',
        mimeType: 'image/bmp',
        bytes: new Uint8Array([1]),
      }),
    ).toThrowError(expect.objectContaining({ title: '图片类型不支持' }))
  })
})

import { describe, expect, it } from 'vitest'
import { runtimeDocumentSchema } from '@/shared/runtimeSchema'
import type { RuntimeDocument } from '@/shared/runtimeTypes'

function validRuntime(): RuntimeDocument {
  return {
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: 'hybrid',
    source: `CoursewareRuntime.define({
      runtimeApiVersion: 2,
      create() { return { destroy() {} } }
    })`,
    content: {
      values: {
        title: '观察小球运动',
        'feedback.success': '实验完成',
      },
      metadata: {
        title: { label: '标题', maxLength: 100 },
      },
    },
    assets: {
      ball: { assetId: 'asset-ball' },
    },
    nodeBindings: { draggableBall: 'node-ball' },
    staticFallback: {
      assetId: 'asset-fallback',
      coverage: 'runtime-layer',
      layer: 'overlay',
    },
  }
}

describe('runtimeDocumentSchema', () => {
  it('接受完整的 RuntimeDocument 并保留文字、素材与静态后备配置', () => {
    const runtime = validRuntime()
    expect(runtimeDocumentSchema.parse(runtime)).toEqual(runtime)
  })

  it('只接受 API 2，并拒绝旧版、未来版本、空源码和未知渲染模式', () => {
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      source: '  \n ',
    }).success).toBe(false)
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      runtimeApiVersion: 1,
    }).success).toBe(false)
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      runtimeApiVersion: 3,
    }).success).toBe(false)
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      renderMode: 'iframe',
    }).success).toBe(false)
  })

  it('接受超过旧 2 MiB 的 UTF-8 源码和超过旧数量的内容与绑定', () => {
    const count = 10_001
    const values = Object.fromEntries(Array.from({ length: count }, (_, index) => [`text${index}`, '课件正文']))
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      source: 'x'.repeat(2 * 1024 * 1024 + 1),
    }).success).toBe(true)
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      source: '课'.repeat(Math.floor(2 * 1024 * 1024 / 3) + 1),
      content: { values, metadata: Object.fromEntries(Object.keys(values).map(key => [key, { maxLength: 1_000_001 }])) },
      assets: Object.fromEntries(Object.keys(values).map(key => [key, { assetId: `asset-${key}` }])),
      nodeBindings: Object.fromEntries(Object.keys(values).map(key => [key, `node-${key}`])),
    }).success).toBe(true)
  })

  it('要求 content.values 全部为字符串且 metadata 只能引用已有文字', () => {
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      content: { values: { title: 42 } },
    }).success).toBe(false)

    const result = runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      content: {
        values: { title: '标题' },
        metadata: { missing: { label: '不存在' } },
      },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('不存在的内容键')
    }
  })

  it('拒绝空素材 ID、不安全绑定键和无效静态后备枚举', () => {
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      assets: { ball: { assetId: '  ' } },
    }).success).toBe(false)
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      assets: { constructor: { assetId: 'asset-ball' } },
    }).success).toBe(false)
    expect(runtimeDocumentSchema.safeParse({
      ...validRuntime(),
      staticFallback: {
        assetId: 'asset-fallback',
        coverage: 'partial-scene',
        layer: 'middle',
      },
    }).success).toBe(false)
  })
})

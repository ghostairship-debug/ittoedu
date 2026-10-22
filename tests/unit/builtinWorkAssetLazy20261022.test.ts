import { beforeEach, expect, test, vi } from 'vitest'

const builtin = vi.hoisted(() => ({
  ready: false,
  source: { kind: 'source' as const, language: 'javascript' as const, source: 'export default { mount() {} }' },
  read: vi.fn(),
  load: vi.fn(),
}))
vi.mock('../../src/core/components/source/builtinSources', () => ({
  getBuiltinComponentSource: (key: string) => {
    builtin.read(key)
    if (!builtin.ready) throw new Error('尚未准备源码')
    return key === 'guoling.shape' ? { ...builtin.source } : undefined
  },
  loadBuiltinComponentSource: async (key: string) => {
    builtin.load(key)
    builtin.ready = true
    return key === 'guoling.shape' ? { ...builtin.source } : undefined
  },
}))

beforeEach(() => {
  vi.resetModules()
  builtin.ready = false
  builtin.read.mockClear()
  builtin.load.mockClear()
})

test('listing all work assets and constructing a native template does not read builtin source', async () => {
  const work = await import('../../src/core/components/library/workAssets')
  const metadata = work.builtInWorkAssetMetadata()
  expect(metadata).toHaveLength(14)
  expect(metadata.every(value => !('definitions' in value) && !('example' in value) && !('resources' in value))).toBe(true)
  const asset = work.builtInWorkAsset('guoling.work.template.mixed-program')!
  expect(asset.id).toBe('guoling.work.template.mixed-program')
  expect(ArrayBuffer.isView(asset.resources.assets['mixed-image'])).toBe(true)
  expect(asset.resources.assets['mixed-image'].byteLength).toBeGreaterThan(0)
  expect(builtin.read).not.toHaveBeenCalled()
  expect(builtin.load).not.toHaveBeenCalled()
})

test('loading one professional variant prepares only its source and preserves an independent editable entry', async () => {
  const work = await import('../../src/core/components/library/workAssets')
  const variant = await work.loadBuiltInWorkAsset('guoling.work.professional.shape-source')
  expect(builtin.load).toHaveBeenCalledExactlyOnceWith('guoling.shape')
  expect(builtin.read).toHaveBeenCalledExactlyOnceWith('guoling.shape')
  expect(variant?.definitions['professional-shape-base'].implementation).toEqual(builtin.source)
  expect(variant?.definitions['professional-shape-variant'].professionalBuiltinKey).toBe('guoling.shape')
  variant!.example.instances['professional-shape'].name = '人工修改'
  expect(work.builtInWorkAsset(variant!.id)!.example.instances['professional-shape'].name).toBe('可编辑图形')
  expect(await work.loadBuiltInWorkAsset('missing')).toBeUndefined()
})

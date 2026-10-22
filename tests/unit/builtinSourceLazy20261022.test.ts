import { beforeEach, expect, it, vi } from 'vitest'

const loaders = vi.hoisted(() => ({
  web: vi.fn(async () => ({ kind: 'source' as const, language: 'javascript' as const, source: 'export default {mount(){}}' })),
  text: vi.fn(async () => ({ kind: 'source' as const, language: 'javascript' as const, source: 'export default {mount(){}}' })),
}))
vi.mock('../../src/shared/generated/componentBuiltinSourceLoaders', () => ({
  builtinComponentSourceLoaders: { 'web.ts': loaders.web, 'text.ts': loaders.text },
}))
beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

it('reads small builtin identities without loading source and shares an actual closure request between aliases', async () => {
  const source = await import('../../src/core/components/source/builtinSources')
  expect(source.builtinComponentSourceKeys).toContain('guoling.text')
  expect(loaders.web).not.toHaveBeenCalled()
  expect(loaders.text).not.toHaveBeenCalled()
  expect(source.hasBuiltinComponentSource('guoling.web')).toBe(false)
  expect(() => source.getBuiltinComponentSource('guoling.web')).toThrow('尚未准备')
  expect(source.getBuiltinComponentSource('missing')).toBeUndefined()
  const [web, program] = await Promise.all([
    source.loadBuiltinComponentSource('guoling.web'), source.loadBuiltinComponentSource('guoling.html-program'),
  ])
  expect(loaders.web).toHaveBeenCalledTimes(1)
  expect(loaders.text).not.toHaveBeenCalled()
  expect(source.hasBuiltinComponentSource('guoling.html-program')).toBe(true)
  expect(web).toEqual(program)
  web!.source = 'caller local change'
  expect(source.getBuiltinComponentSource('guoling.web')!.source).toBe('export default {mount(){}}')
})

it('reports a failed source request and permits the same actual entry to be prepared again', async () => {
  loaders.text.mockRejectedValueOnce(new Error('source load failed'))
  const source = await import('../../src/core/components/source/builtinSources')
  await expect(source.loadBuiltinComponentSource('guoling.text')).rejects.toThrow('source load failed')
  expect(source.hasBuiltinComponentSource('guoling.text')).toBe(false)
  expect(() => source.getBuiltinComponentSource('guoling.text')).toThrow('尚未准备')
  await expect(source.loadBuiltinComponentSource('guoling.text')).resolves.toMatchObject({ kind: 'source' })
  expect(loaders.text).toHaveBeenCalledTimes(2)
  await expect(source.loadBuiltinComponentSource('missing')).resolves.toBeUndefined()
})

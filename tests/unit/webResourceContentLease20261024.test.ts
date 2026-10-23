// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createWebResourceUrlLease, webRuntimeResourceAddress } from '../../src/components/web/resourceUrlLease'

function resourceRealm() {
  const createObjectURL = vi.fn((_blob: Blob): string => `blob:content/${createObjectURL.mock.calls.length}`)
  const revokeObjectURL = vi.fn()
  const decode = vi.fn(atob)
  return { createObjectURL, revokeObjectURL, decode,
    realm: { URL: { createObjectURL, revokeObjectURL } as unknown as typeof URL, Blob, atob: decode } }
}

it('shares one decode and Blob for duplicate payloads while preserving logical bindings', () => {
  const { realm, decode, createObjectURL, revokeObjectURL } = resourceRealm()
  const lease = createWebResourceUrlLease(realm)
  const source = 'data:image/png;base64,YQ=='
  expect(lease.update({ first: source, second: source })).toEqual({ first: 'blob:content/1', second: 'blob:content/2' })
  expect(decode).toHaveBeenCalledTimes(1)
  expect(createObjectURL).toHaveBeenCalledTimes(2)
  expect(createObjectURL.mock.calls[0]![0]).toBe(createObjectURL.mock.calls[1]![0])
  expect(lease.sources).toEqual({ first: source, second: source })
  expect(lease.resolve(source)).toBeUndefined()
  expect(lease.resolve('cw-resource:photo', { 'cw-resource:photo': 'second' })).toBe('blob:content/2')
  expect(lease.matches('cw-resource:photo', 'blob:content/1', { 'cw-resource:photo': 'second' })).toBe(false)
  expect(lease.matches(source, 'blob:content/1')).toBe(true)
  expect(lease.project(`${webRuntimeResourceAddress('first')} ${webRuntimeResourceAddress('second')}`))
    .toBe('blob:content/1 blob:content/2')
  expect(lease.reverse(lease.urls.first!)).toBe('first')
  expect(lease.reverse(lease.urls.second!)).toBe('second')
  expect(lease.update({ second: source })).toEqual({ second: 'blob:content/2' })
  expect(lease.resolve(source)).toBe('blob:content/2')
  expect(revokeObjectURL).not.toHaveBeenCalled()
  lease.release(); lease.release()
  expect(revokeObjectURL.mock.calls).toEqual([['blob:content/1'], ['blob:content/2']])
})

it('retains old versions until release and reuses content after IDs change or disappear', () => {
  const { realm, decode, createObjectURL, revokeObjectURL } = resourceRealm()
  const lease = createWebResourceUrlLease(realm)
  const original = 'data:image/png;base64,YQ==', replacement = 'data:image/png;base64,Yg=='
  expect(lease.update({ first: original, second: original })).toEqual({ first: 'blob:content/1', second: 'blob:content/2' })
  expect(lease.update({ first: replacement, second: original })).toEqual({ first: 'blob:content/3', second: 'blob:content/2' })
  expect(lease.update({})).toEqual({})
  expect(lease.resolve(original)).toBeUndefined()
  expect(lease.update({ first: original, second: original })).toEqual({ first: 'blob:content/1', second: 'blob:content/2' })
  expect(lease.update({ restored: original, changed: replacement })).toEqual({ restored: 'blob:content/4', changed: 'blob:content/5' })
  expect(lease.update({ first: replacement })).toEqual({ first: 'blob:content/3' })
  expect(decode).toHaveBeenCalledTimes(2)
  expect(createObjectURL).toHaveBeenCalledTimes(5)
  expect(createObjectURL.mock.calls[0]![0]).toBe(createObjectURL.mock.calls[1]![0])
  expect(createObjectURL.mock.calls[0]![0]).toBe(createObjectURL.mock.calls[3]![0])
  expect(createObjectURL.mock.calls[2]![0]).toBe(createObjectURL.mock.calls[4]![0])
  expect(revokeObjectURL).not.toHaveBeenCalled()
  lease.release()
  expect(revokeObjectURL.mock.calls).toEqual([['blob:content/1'], ['blob:content/2'], ['blob:content/4'], ['blob:content/3'], ['blob:content/5']])
  expect(lease.update({ late: original })).toEqual({ first: 'blob:content/3' })
  expect(createObjectURL).toHaveBeenCalledTimes(5)
})

it('leaves external and existing Blob URLs untouched and scopes materialization to its consuming realm', () => {
  const first = resourceRealm(), second = resourceRealm()
  const firstLease = createWebResourceUrlLease(first.realm), secondLease = createWebResourceUrlLease(second.realm)
  const source = 'data:image/png;base64,YQ=='
  expect(firstLease.update({ external: 'https://example.test/image.webp', blob: 'blob:existing', picture: source }))
    .toEqual({ external: 'https://example.test/image.webp', blob: 'blob:existing', picture: 'blob:content/1' })
  expect(secondLease.update({ picture: source }).picture).toBe('blob:content/1')
  expect(first.decode).toHaveBeenCalledTimes(1)
  expect(second.decode).toHaveBeenCalledTimes(1)
  firstLease.release(); secondLease.release()
  expect(first.revokeObjectURL.mock.calls).toEqual([['blob:content/1']])
  expect(second.revokeObjectURL.mock.calls).toEqual([['blob:content/1']])
})

it('registers a large resource table without decoding unused entries or reverse lookup candidates', () => {
  const { realm, decode, createObjectURL, revokeObjectURL } = resourceRealm()
  const lease = createWebResourceUrlLease(realm)
  const resources = Object.fromEntries(Array.from({ length: 100 }, (_, index) =>
    [`image-${index}`, `data:image/png;base64,${btoa(`image-${index}`)}`]))
  const urls = lease.update(resources)
  expect(Object.keys(urls)).toHaveLength(100)
  expect(Object.getOwnPropertyDescriptor(urls, 'image-7')).toMatchObject({ enumerable: true, configurable: true })
  expect(lease.reverse('blob:unknown', { 'cw-resource:unused': 'image-99' })).toBeUndefined()
  lease.update({ ...resources })
  expect(decode).not.toHaveBeenCalled()
  expect(createObjectURL).not.toHaveBeenCalled()
  const used = urls['image-7']!
  expect(lease.reverse(used, { 'cw-resource:unused': 'image-99', 'cw-resource:used': 'image-7' }))
    .toBe('cw-resource:used')
  expect(lease.reverse(used)).toBe('image-7')
  expect(decode).toHaveBeenCalledTimes(1)
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  lease.update({ ...resources })
  expect(urls['image-7']).toBe(used)
  expect(decode).toHaveBeenCalledTimes(1)
  lease.release()
  expect(revokeObjectURL.mock.calls).toEqual([[used]])
  // A disposed lease cannot create new realm resources through old references.
  void urls['image-99']
  expect(decode).toHaveBeenCalledTimes(1)
  expect(createObjectURL).toHaveBeenCalledTimes(1)
})

it('keeps reverse lookup and ambiguous source resolution lazy while maintaining restored identities', () => {
  const { realm, decode, createObjectURL, revokeObjectURL } = resourceRealm()
  const lease = createWebResourceUrlLease(realm)
  const source = 'data:image/png;base64,YQ==', external = 'https://example.test/photo.webp'
  const urls = lease.update({ first: source, second: source, external })
  expect(lease.resolve(source)).toBeUndefined()
  expect(lease.reverse(external, { 'cw-resource:external': 'external' })).toBe('cw-resource:external')
  expect(decode).not.toHaveBeenCalled()
  const first = lease.resolve('cw-resource:first', { 'cw-resource:first': 'first' })!
  expect(lease.reverse(first, { 'cw-resource:second': 'second', 'cw-resource:first': 'first' })).toBe('cw-resource:first')
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  const second = urls.second!
  expect(second).not.toBe(first)
  expect(decode).toHaveBeenCalledTimes(1)
  expect(createObjectURL.mock.calls[0]![0]).toBe(createObjectURL.mock.calls[1]![0])
  lease.update({ first: source, external })
  expect(lease.reverse(second)).toBeUndefined()
  expect(revokeObjectURL).not.toHaveBeenCalled()
  lease.update({ first: source, second: source, external })
  expect(lease.reverse(second)).toBe('second')
  expect(urls.second).toBe(second)
  expect(decode).toHaveBeenCalledTimes(1)
  expect(createObjectURL).toHaveBeenCalledTimes(2)
  lease.release()
  expect(revokeObjectURL.mock.calls).toEqual([[first], [second]])
})

it('materializes explicitly requested table values and projects only addressed resources synchronously', () => {
  const { realm, decode, createObjectURL } = resourceRealm()
  const lease = createWebResourceUrlLease(realm)
  const urls = lease.update({ first: 'data:image/png;base64,YQ==', second: 'data:image/png;base64,Yg==' })
  expect(lease.project(`image:${webRuntimeResourceAddress('second')}`)).toBe('image:blob:content/1')
  expect(decode).toHaveBeenCalledTimes(1)
  expect(Object.values(urls)).toEqual(['blob:content/2', 'blob:content/1'])
  expect(decode).toHaveBeenCalledTimes(2)
  expect(createObjectURL).toHaveBeenCalledTimes(2)
  lease.release()
})

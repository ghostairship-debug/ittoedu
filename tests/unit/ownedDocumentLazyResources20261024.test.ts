import { afterEach, expect, it, vi } from 'vitest'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { installOwnedDocumentAuthoring } from '../../src/components/web/ownedDocumentAuthoring'
import { installAuthoredDocumentPrograms } from '../../src/components/web/authoredDocumentBootstrap'
import { createWebResourceUrlLease } from '../../src/components/web/resourceUrlLease'

const releases: Array<() => void> = []
afterEach(() => { releases.splice(0).forEach(release => release()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

it('registers the real parser resource directory without decoding unused assets', () => {
  const decode = vi.spyOn(window, 'atob')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:parser-used') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const resources = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`asset-${index}`, 'data:image/png;base64,YQ==']))
  const parser = installAuthoredDocumentPrograms({ prefix: 'guoling-test:', property: '__lazy_parser_test', classic: {}, resources }, undefined,
    createWebResourceUrlLease)
  releases.push(parser.release)
  expect(decode).not.toHaveBeenCalled()
  expect(Object.keys(parser.resourceLease.urls)).toHaveLength(100)
  expect(parser.resourceLease.resolve('asset-7')).toBe('blob:parser-used')
  expect(decode).toHaveBeenCalledOnce()
  expect(parser.resourceLease.reverse('blob:parser-used')).toBe('asset-7')
  expect(decode).toHaveBeenCalledOnce()
})

it('uses the owned parser resource reverse callback without enumerating unrelated live URLs', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
  const urls: Record<string, string> = { used: 'blob:used' }
  Object.defineProperty(urls, 'unused', { enumerable: true, get() { throw new Error('Unused resource was materialized') } })
  const resourceReference = vi.fn(() => 'used')
  let reference: string | undefined
  const factory: typeof createDomAuthoring = (root, options) => {
    reference = options?.resourceReference?.('blob:used')
    return createDomAuthoring(root, options)
  }
  const owner = installOwnedDocumentAuthoring('lazy-owned', 'frame:0', factory, {
    runtimeResources: () => urls, resourceReference,
  })
  releases.push(owner.dispose)
  document.dispatchEvent(new Event('DOMContentLoaded'))
  expect(reference).toBe('used')
  expect(resourceReference).toHaveBeenCalledWith('blob:used', {})
})

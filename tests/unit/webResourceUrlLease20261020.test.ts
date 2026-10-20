// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createWebResourceUrlLease, webRuntimeResourceAddress } from '../../src/components/web/resourceUrlLease'
import { resolveWebResourceBindings } from '../../src/components/web/resources'
import { authoredDocumentBootstrap, authoredDocumentProgramsSource } from '../../src/components/web/authoredDocumentBootstrap'
import type { ComponentInstance } from '../../src/shared/contracts/component-platform'

it('reuses each resource version in the consuming realm and retains its old version until scope release', () => {
  const createObjectURL = vi.fn(() => `blob:realm/${vi.mocked(createObjectURL).mock.calls.length}`), revokeObjectURL = vi.fn()
  const lease = createWebResourceUrlLease({ URL: { createObjectURL, revokeObjectURL } as unknown as typeof URL, Blob, atob })
  const first = { picture: 'data:image/png;base64,YQ==' }
  expect(lease.update(first).picture).toBe('blob:realm/1')
  expect(lease.update({ ...first }).picture).toBe('blob:realm/1')
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  expect(lease.project(`url(${webRuntimeResourceAddress('picture')})`)).toBe('url(blob:realm/1)')
  expect(lease.resolve(first.picture)).toBe('blob:realm/1')
  expect(lease.resolve('cw-resource:original', { 'cw-resource:original': 'picture' })).toBe('blob:realm/1')
  expect(lease.update({ picture: 'data:image/png;base64,Yg==' }).picture).toBe('blob:realm/2')
  expect(revokeObjectURL).not.toHaveBeenCalled()
  lease.release(); lease.release()
  expect(revokeObjectURL.mock.calls).toEqual([['blob:realm/1'], ['blob:realm/2']])
})

it('keeps one original resource payload in the parser table and compact addresses in markup, metadata and programs', () => {
  const image = `data:image/png;base64,${'QUJD'.repeat(20000)}`
  const original = { id: 'web', definitionId: 'web', data: {
    html: '<!doctype html><html><head></head><body><img src="cw-resource:picture"><script>window.picture="cw-resource:picture";</script></body></html>',
    css: '.photo{background:url(cw-resource:picture)}', resourceBindings: { 'cw-resource:picture': 'asset-one' },
  } } as ComponentInstance
  const projected = resolveWebResourceBindings(original, webRuntimeResourceAddress)
  expect(JSON.stringify(projected.data)).not.toContain(image)
  expect(JSON.stringify(projected.data)).toContain('guoling-resource:asset-one')
  const html = authoredDocumentBootstrap(projected.data as any, { nonce: 'lease-proof', instanceId: original.id,
    resources: { 'asset-one': image }, resourceCss: (original.data as any).css, bridge: authoredDocumentProgramsSource })
  expect(html.split(image).length - 1).toBe(1)
  expect(html).toContain('document.write(')
  expect(html).toContain('cw-resource:picture')
  expect(original.data).toMatchObject({ html: expect.stringContaining('src="cw-resource:picture"') })
})

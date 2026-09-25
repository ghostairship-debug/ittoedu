import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { cloneDocumentResources } from '../../src/core/drivers/resources'

const foreignBytes = (values: number[]) => runInNewContext(`new Uint8Array(${JSON.stringify(values)})`) as Uint8Array

it('accepts resource bytes created in another realm and copies them into owned bytes', () => {
  const foreign = foreignBytes([1, 2, 3])
  expect(foreign instanceof Uint8Array).toBe(false)
  const cloned = cloneDocumentResources({ assets: { 'image-1': foreign }, components: { pkg: { 'index.js': foreignBytes([4]) } } })
  expect(cloned.assets['image-1']).toBeInstanceOf(Uint8Array)
  expect(Array.from(cloned.assets['image-1']!)).toEqual([1, 2, 3])
  expect(Array.from(cloned.components.pkg!['index.js']!)).toEqual([4])
})

it('still rejects typed views that are not bytes', () => {
  expect(() => cloneDocumentResources({ assets: { 'image-1': new Float32Array([1]) as unknown as Uint8Array }, components: {} })).toThrow('素材身份或字节无效')
  expect(() => cloneDocumentResources({ assets: {}, components: { pkg: { 'a.js': new DataView(new ArrayBuffer(1)) as unknown as Uint8Array } } })).toThrow('组件文件不是有效字节')
})

it('digests bytes the same whichever realm created them', () => {
  expect(documentDigest({ bytes: foreignBytes([7, 8]) })).toBe(documentDigest({ bytes: new Uint8Array([7, 8]) }))
  expect(documentDigest({ bytes: new Uint8Array([7, 8]) })).not.toBe(documentDigest({ bytes: { 0: 7, 1: 8 } }))
})

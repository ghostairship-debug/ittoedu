// @vitest-environment node
import { expect, it } from 'vitest'
import { objectInsertInputSchema, objectLayoutInputSchema, objectUpdateInputSchema, surfaceRecipeInputSchema } from '../../src/core/tools/toolSchemas'
import { inspectProjectFont } from '../../src/shared/fonts/projectFontFile'

it('accepts complete long content and large layout intentions through the current public schemas while rejecting invalid author fields', () => {
  const text = '正文'.repeat(16385), targets = Array.from({ length: 201 }, (_, index) => `object-${index}`)
  expect(objectInsertInputSchema.parse({ target: 'surface', kind: 'text', text }).text).toBe(text)
  expect(objectUpdateInputSchema.parse({ target: 'object', properties: { data: { content: { inlines: [{ type: 'text', text }] }, retainedAuthorField: '自定义'.repeat(1201) } } }))
    .toMatchObject({ properties: { data: { content: { inlines: [{ type: 'text', text }] } } } })
  expect(objectLayoutInputSchema.parse({ targets, intent: { kind: 'align', alignment: 'left' } }).targets).toEqual(targets)
  expect(objectLayoutInputSchema.parse({ targets, intent: { kind: 'distribute', axis: 'horizontal' } }).targets).toEqual(targets)
  const title = '长标题'.repeat(1201)
  expect(surfaceRecipeInputSchema.parse({ target: 'page', recipeId: 'cover-v1', slots: { title } }).slots.title).toBe(title)
  expect(objectInsertInputSchema.safeParse({ target: 'surface', kind: 'text', text: 123 }).success).toBe(false)
  expect(objectUpdateInputSchema.safeParse({ target: 'object', properties: { unregisteredProperty: 'invalid' } }).success).toBe(false)
  expect(objectLayoutInputSchema.safeParse({ targets: [123], intent: { kind: 'align', alignment: 'left' } }).success).toBe(false)
})

it('inspects a valid font larger than 32 MiB and rejects incomplete headers and out-of-bounds table bytes', () => {
  const bytes = new Uint8Array(32 * 1024 * 1024 + 1), view = new DataView(bytes.buffer)
  view.setUint32(0, 0x00010000); view.setUint16(4, 1)
  view.setUint32(12, 0x44415441); view.setUint32(20, 28); view.setUint32(24, bytes.length - 28)
  expect(inspectProjectFont(bytes)).toEqual({ mimeType: 'font/ttf', extension: 'ttf' })
  view.setUint32(24, bytes.length)
  expect(() => inspectProjectFont(bytes)).toThrow('字体表超出文件边界')
  expect(() => inspectProjectFont(new Uint8Array(11))).toThrow('字体文件头不完整')
})

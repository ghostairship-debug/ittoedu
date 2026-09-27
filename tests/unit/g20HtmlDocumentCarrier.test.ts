// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createHtmlDocumentRuntimeSource, unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import { scanRuntimePageText } from '../../src/shared/runtimeText/scanPageText'

const key = 'a'.repeat(64)

function execute(source: string) {
  let definition: { create(context: unknown): { destroy(): void; suspend(): void } } | undefined
  new Function('CoursewareRuntime', source)({ define(value: typeof definition) { definition = value } })
  expect(definition).toBeDefined()
  return definition!
}

describe('HTML document API 3 carrier', () => {
  it('keeps document markup and script text available through an exact read-only envelope', () => {
    const html = `<!doctype html><html><head><style>h1{color:red}</style></head><body><div id="root"></div><script>const next = "下一句对话";document.getElementById("root").textContent=next</script></body></html>`
    const source = createHtmlDocumentRuntimeSource({ html, resourceKeys: [] })
    expect(source).toContain('CoursewareRuntime.define(')
    expect(unpackHtmlDocumentRuntimeSource(source)).toEqual({ html, resourceKeys: [] })
    expect(scanRuntimePageText(source).entries.map(entry => entry.text)).toContain('下一句对话')
    expect(unpackHtmlDocumentRuntimeSource(source + '// tampered')).toBeNull()
    expect(unpackHtmlDocumentRuntimeSource('CoursewareRuntime.define({})')).toBeNull()
  })

  it('resolves stable asset bindings at each mount and destroys the document', async () => {
    const source = createHtmlDocumentRuntimeSource({
      html: `<html><body><img src="cw-resource:${key}"><script>window.clip="cw-resource:${key}"</script></body></html>`,
      resourceKeys: [key, key],
    })
    const definition = execute(source)
    const root = document.createElement('div')
    const waitUntil = vi.fn()
    const url = vi.fn(() => 'blob:https://example.test/asset-id')
    const lifecycle = definition.create({ dom: { root }, assets: { url }, capture: { waitUntil } })
    const iframe = root.querySelector('iframe')!
    expect(iframe).toBeTruthy()
    expect(iframe.srcdoc).toContain('blob:https://example.test/asset-id')
    expect(iframe.srcdoc).not.toContain('cw-resource:')
    expect(source).not.toContain('blob:https://example.test/asset-id')
    expect(url).toHaveBeenCalledOnce()
    iframe.dispatchEvent(new Event('load'))
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined()
    lifecycle.destroy()
    expect(root.querySelector('iframe')).toBeNull()
  })

  it('rejects missing bindings, unsafe runtime URLs and oversized UTF-8 source', () => {
    expect(() => createHtmlDocumentRuntimeSource({ html: `cw-resource:${key}`, resourceKeys: [] })).toThrow('绑定缺失')
    expect(() => createHtmlDocumentRuntimeSource({ html: 'a'.repeat(2 * 1024 * 1024), resourceKeys: [] })).toThrow('2 MiB')
    const definition = execute(createHtmlDocumentRuntimeSource({ html: `cw-resource:${key}`, resourceKeys: [key] }))
    expect(() => definition.create({ dom: { root: document.createElement('div') }, assets: { url: () => 'blob:"</script>' }, capture: { waitUntil() {} } })).toThrow('不能安全嵌入')
  })
})

import { describe, expect, it } from 'vitest'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { createTextComponentData } from '../../src/components/text/data'
import { buildComponentPrintHtml, composeComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { buildPdfPrintHtml, pdfPrintPageName } from '../../src/renderer/export/course/pdfPrintHtml'
import { resolveFlowDocxPageBox, resolvePrintPageSize } from '../../src/renderer/export/flowPageBox'

describe('X4 named print pages', () => {
  it('consumes A4, letter, orientation and the actual native capture sizes', () => {
    expect(resolveFlowDocxPageBox('letter', 'landscape')).toMatchObject({ widthTwips: 15840, heightTwips: 12240, marginTwips: 1134 })
    expect(resolvePrintPageSize('surface-native', 'auto', { width: 960, height: 640 })).toEqual({ widthPx: 960, heightPx: 640, cssSize: '960px 640px' })
    expect(resolvePrintPageSize('surface-native', 'portrait', { width: 960, height: 640 })).toEqual({ widthPx: 640, heightPx: 960, cssSize: '640px 960px' })
    expect(resolvePrintPageSize('surface-native').cssSize).toBe('A4 portrait')
    const capture = { dataUrl: 'data:image/png;base64,AA==', width: 960, height: 640 }
    const native = new DOMParser().parseFromString(buildPdfPrintHtml('native', [capture, { ...capture, width: 600, height: 800 }]), 'text/html')
    expect(native.querySelectorAll('.page')[1]?.getAttribute('style')).toContain('width:600px;height:800px')
    expect(native.head.textContent).toContain('size: 960px 640px')
    const letter = new DOMParser().parseFromString(buildPdfPrintHtml('letter', [capture], { pageSize: 'letter', orientation: 'landscape' }), 'text/html')
    expect(letter.head.textContent).toContain('size: letter landscape')
    expect(letter.querySelector('.page')?.getAttribute('style')).toContain('width:1056px;height:816px')
  })

  it('keeps semantic Flow CSS and fixed capture CSS scoped with independent named paper rules', async () => {
    const project = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'x4-flow', revision: 0, title: '打印检查',
      definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
      instances: { body: { id: 'body', definitionId: 'text', data: createTextComponentData({ inlines: [{ type: 'text', text: 'Flow reading content' }] }) } },
      surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow title', childIds: ['body'] }], global: { underlay: [], overlay: [] }, assets: {} })
    const flow = await buildComponentPrintHtml(project, { surfaceId: 'flow', pageSize: 'letter', orientation: 'landscape' })
    const capture = buildPdfPrintHtml('Slide', [{ dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600 }], { pageName: 'slide' })
    const merged = new DOMParser().parseFromString(composeComponentPrintHtml('Mixed', [capture, flow.html]), 'text/html')
    expect(merged.querySelectorAll('.component-print-fragment')).toHaveLength(2)
    expect(merged.querySelector('[data-component-print-surface="flow"]')?.textContent).toContain('Flow reading content')
    const flowName = pdfPrintPageName('flow')
    expect(merged.querySelector('[data-component-print-root]')?.getAttribute('style')).toContain(`page: ${flowName}`)
    expect(merged.head.textContent).toContain(`@page ${flowName}{size:letter landscape;margin:20mm}`)
    expect(merged.head.textContent).toContain('size: 800px 600px')
    expect(merged.head.textContent).toContain(`[data-component-print-root="${flowName}"] th,[data-component-print-root="${flowName}"] td`)
    expect(merged.querySelector('.page')).not.toBeNull()
  })
})

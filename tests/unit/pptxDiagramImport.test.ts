import { expect, it } from 'vitest'
import { parsePptxImport } from '@/renderer/project/pptxImport'
import { pptxDiagramFixture } from '../fixtures/pptxDiagram'

it.each(['process1', 'orgChart1', 'cycle2'] as const)('imports %s nodes, text frames, colors and cached connections as Native content', async kind => {
  const draft = await parsePptxImport(pptxDiagramFixture(kind))
  const items = draft.slides[0]!.items.filter(item => item.label.startsWith('图示'))
  expect(items).toHaveLength(kind === 'cycle2' ? 9 : 8)
  const texts = items.filter(item => item.kind === 'native' && item.content.nativeType === 'text')
  expect(texts.map(item => item.kind === 'native' && item.content.nativeType === 'text' && item.content.data.text)).toEqual(['开始', '观察', '解释'])
  for (const item of texts) {
    if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('missing Native text')
    expect(item.content.data.runs[0].style.color).toBe('#ffffff')
    expect(item.frame.width).toBeCloseTo(1300000 * 1280 / 12192000)
  }
  expect(items.filter(item => item.kind === 'native' && item.content.nativeType === 'shape' && item.content.data.pathGeometry)).toHaveLength(kind === 'cycle2' ? 3 : 2)
  expect(draft.issues.filter(issue => issue.message.includes('跳过'))).toEqual([])
  expect(draft.assets).toHaveLength(0)
})

it.each(['stale', 'unsupportedChild', 'unsupportedLayout', 'external', 'missingConnection'] as const)('rejects the entire diagram for %s while preserving unrelated page content', async key => {
  const draft = await parsePptxImport(pptxDiagramFixture('orgChart1', { [key]: true }))
  expect(draft.slides).toHaveLength(1)
  expect(draft.slides[0]!.items).toHaveLength(2)
  expect(draft.slides[0]!.items.some(item => item.label.startsWith('图示'))).toBe(false)
  expect(draft.issues.some(issue => issue.type === 'SmartArt')).toBe(true)
})

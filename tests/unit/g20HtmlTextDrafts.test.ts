import { expect, it } from 'vitest'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'
import type { HtmlSelectedTarget } from '../../src/renderer/documentFiles/html/htmlPreviewController'

function target(source: string, text: string, handle = 'text'): HtmlSelectedTarget {
  const start = source.indexOf(text)
  return { report: { handle, kind: 'text', rawText: text, domPath: [], sectionOrder: null,
    attributeName: null, rect: { x: 0, y: 0, width: 20, height: 10 }, scriptCreated: false },
  resolved: { handle, status: 'editable', locator: { documentId: 'doc', epoch: 'epoch', revision: 1,
    bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: source.length },
    valueSpan: { start, end: start + text.length }, attributeName: null, expectedRaw: text } } }
}

it('recovers drafts by source range after frame handles change and prepares all drafts with HTML escaping', () => {
  const source = '<p>first</p>\r\n<p>second</p>'
  const drafts = new HtmlTextDrafts()
  drafts.change(target(source, 'first'), source, 'A & B\n<C>')
  drafts.change(target(source, 'second'), source, '最后')
  expect(drafts.find(target(source, 'first', 'new-frame-handle'), source)?.value).toBe('A & B\n<C>')
  const prepared = drafts.prepare(source)
  expect(prepared).toEqual({ ready: true, source: '<p>A &amp; B\r\n&lt;C&gt;</p>\r\n<p>最后</p>' })
  expect(drafts.read()).toHaveLength(2)
  drafts.reconcile(prepared.source)
  expect(drafts.read()).toEqual([])
})

it('maps a disjoint source edit but retains input and refuses to guess when its own text changes', () => {
  const source = '<p>first</p><p>second</p>'
  const drafts = new HtmlTextDrafts()
  drafts.change(target(source, 'second'), source, 'my text')
  const shifted = source.replace('first', 'longer first')
  expect(drafts.prepare(shifted)).toEqual({ ready: true, source: '<p>longer first</p><p>my text</p>' })
  const changed = shifted.replace('second', 'their text')
  expect(drafts.prepare(changed)).toEqual({ ready: false, source: changed })
  expect(drafts.read()[0]).toMatchObject({ value: 'my text', issue: expect.stringContaining('草稿仍保留') })
  // Returning to the original text makes the same retained draft usable again.
  expect(drafts.prepare(shifted).ready).toBe(true)
})

it('keeps input typed after Save until that newer value is itself submitted', () => {
  const source = '<p>old</p>'
  const drafts = new HtmlTextDrafts()
  const selected = target(source, 'old')
  drafts.change(selected, source, 'saved')
  const submitted = drafts.prepare(source)
  drafts.change(selected, source, 'newer input')
  drafts.reconcile(submitted.source)
  expect(drafts.read()[0]).toMatchObject({ original: 'saved', value: 'newer input', source: '<p>saved</p>' })
  expect(drafts.prepare(submitted.source)).toEqual({ ready: true, source: '<p>newer input</p>' })
})

it.each(['typed while saving', 'old'])('keeps %s through optimistic source, repeated flush and ordered save ACKs', value => {
  const source = '<p>old</p>'
  const drafts = new HtmlTextDrafts()
  const selected = target(source, 'old')
  drafts.change(selected, source, 'first save')
  const first = drafts.prepare(source)
  // The document session publishes this optimistic source before its IPC receipt.
  expect(drafts.prepare(first.source)).toEqual(first)
  expect(drafts.read()).toHaveLength(1)
  drafts.change(selected, source, value)
  const second = drafts.prepare(first.source)
  expect(second).toEqual({ ready: true, source: `<p>${value}</p>` })
  expect(drafts.find(selected, source)?.value).toBe(value)
  drafts.reconcile(first.source)
  expect(drafts.read()[0]).toMatchObject({ original: 'first save', value, issue: undefined })
  expect(drafts.prepare(second.source)).toEqual(second)
  drafts.reconcile(second.source)
  expect(drafts.read()).toEqual([])
})

it('clears only the acknowledged explicit edit and leaves a different retained draft', () => {
  const source = '<p>first</p><p>second</p>'
  const drafts = new HtmlTextDrafts()
  const selected = target(source, 'first')
  drafts.change(selected, source, 'one')
  drafts.change(target(source, 'second'), source, 'two')
  drafts.reconcile(source.replace('first', 'one'))
  drafts.applied(selected, source, 'one')
  expect(drafts.read()).toHaveLength(1)
  expect(drafts.prepare(source.replace('first', 'one'))).toEqual({ ready: true, source: '<p>one</p><p>two</p>' })
})

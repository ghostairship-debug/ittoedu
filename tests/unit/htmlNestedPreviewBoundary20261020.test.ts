import { expect, it } from 'vitest'
import type { WebFrameMain } from 'electron'
import { isAllowedEditorPreviewFrameUrl, isAllowedHtmlPreviewChildFrameUrl, registerHtmlPreviewFrameEntry } from '../../src/main/security'
import { htmlPreviewFileUrl } from '../../src/main/workbench/htmlPreview/htmlPreviewProtocol'

it('loads a nested HTML resource only through its active owner lease', () => {
  const token = 'a'.repeat(64), other = 'b'.repeat(64)
  const entry = htmlPreviewFileUrl(token, 'wrapper.html')
  const unregister = registerHtmlPreviewFrameEntry(entry, 71)
  const frame = { parent: { url: entry, parent: null } } as unknown as WebFrameMain
  try {
    expect(isAllowedHtmlPreviewChildFrameUrl(htmlPreviewFileUrl(token, 'pages/lesson.html'), 71, frame)).toBe(true)
    expect(isAllowedHtmlPreviewChildFrameUrl('about:srcdoc', 71, frame)).toBe(true)
    expect(isAllowedHtmlPreviewChildFrameUrl(htmlPreviewFileUrl(other, 'lesson.html'), 71, frame)).toBe(false)
    expect(isAllowedHtmlPreviewChildFrameUrl(htmlPreviewFileUrl(token, 'lesson.html'), 72, frame)).toBe(false)
    expect(isAllowedHtmlPreviewChildFrameUrl(htmlPreviewFileUrl(token, 'script.js'), 71, frame)).toBe(false)
    expect(isAllowedHtmlPreviewChildFrameUrl('file:///C:/other.html', 71, frame)).toBe(false)
  } finally { unregister() }
  expect(isAllowedHtmlPreviewChildFrameUrl(htmlPreviewFileUrl(token, 'lesson.html'), 71, frame)).toBe(false)
})

it('loads an opaque Blob descendant only while its actual ancestor lease belongs to the consuming window', () => {
  const token = 'c'.repeat(64), entry = htmlPreviewFileUrl(token, 'component.html')
  const opaque = 'blob:null/7ad2b149-0a6a-4fa9-aaf3-6cf202082d95'
  const frame = { parent: { url: entry, parent: null } } as unknown as WebFrameMain
  const nested = { parent: { url: opaque, parent: frame.parent } } as unknown as WebFrameMain
  const unregister = registerHtmlPreviewFrameEntry(entry, 73)
  try {
    expect(isAllowedHtmlPreviewChildFrameUrl(opaque, 73, frame)).toBe(true)
    expect(isAllowedHtmlPreviewChildFrameUrl(opaque, 73, nested)).toBe(true)
    expect(isAllowedHtmlPreviewChildFrameUrl(opaque, 74, frame)).toBe(false)
    expect(isAllowedHtmlPreviewChildFrameUrl(opaque, 73)).toBe(false)
    expect(isAllowedHtmlPreviewChildFrameUrl(opaque, 73, { parent: null } as unknown as WebFrameMain)).toBe(false)
    expect(isAllowedEditorPreviewFrameUrl(opaque, 'courseware-editor://app/index.html')).toBe(false)
  } finally { unregister() }
  expect(isAllowedHtmlPreviewChildFrameUrl(opaque, 73, frame)).toBe(false)
})

it('keeps nonopaque Blob origins and ordinary navigation confined to the active preview resource host', () => {
  const token = 'd'.repeat(64), other = 'e'.repeat(64), entry = htmlPreviewFileUrl(token, 'component.html')
  const origin = new URL(entry), otherOrigin = new URL(htmlPreviewFileUrl(other, 'component.html'))
  const frame = { parent: { url: entry, parent: null } } as unknown as WebFrameMain
  const unregister = registerHtmlPreviewFrameEntry(entry, 75)
  try {
    expect(isAllowedHtmlPreviewChildFrameUrl(`blob:${origin.protocol}//${origin.host}/owned`, 75, frame)).toBe(true)
    for (const candidate of [
      `blob:${otherOrigin.protocol}//${otherOrigin.host}/other`, 'blob:https://example.com/foreign',
      'blob:courseware-editor://app/editor', 'blob:null/', 'blob:undefined/id',
      'https://example.com/foreign.html', 'data:text/html,foreign', 'file:///C:/other.html',
    ]) expect(isAllowedHtmlPreviewChildFrameUrl(candidate, 75, frame), candidate).toBe(false)
  } finally { unregister() }
})

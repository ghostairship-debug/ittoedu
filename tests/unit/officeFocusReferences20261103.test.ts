import { describe, expect, it } from 'vitest'
import { mergeAutomaticReferences } from '../../src/renderer/workbench/composerReferences'
import type { ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'
import { OfficeFocusController } from '../../src/renderer/workbench/officeFocus'
import { captureFileContext, refreshFileContextVersions, fileFocusReference, fileReferenceIdentity } from '../../src/renderer/workbench/composerFileReferences'
import { executionDesktopRequestSchema } from '../../src/shared/workbench/executionDesktop'
import { executionFileContextSchema, formatExecutionFileContext } from '../../src/shared/workbench/fileContext'

const ppt = { path: 'D:\\work\\slides.pptx', name: 'slides.pptx', format: 'pptx', fileVersion: 'v1', bindingVersion: 1 }
const sheet = { path: 'D:\\work\\table.xlsx', name: 'table.xlsx', format: 'xlsx', fileVersion: 'x1', bindingVersion: 1 }

describe('professional-file focus and message references', () => {
  it('follows the active page/object and worksheet while retaining only open files', () => {
    const focus = new OfficeFocusController()
    focus.setOpenFiles([ppt, sheet], ppt.path)
    focus.updateLocation(ppt.path, { page: 2, part: 'ppt/slides/slide2.xml', shapeIds: ['7'] })
    expect(captureFileContext(focus.capture(), [], new Set()).references[0]).toMatchObject({ path: ppt.path, scope: 'object', focus: { shapeIds: ['7'] } })
    focus.setOpenFiles([ppt, sheet], sheet.path)
    focus.updateLocation(sheet.path, { sheet: '预算', range: 'B2:C4' })
    expect(captureFileContext(focus.capture(), [], new Set()).references[0]).toMatchObject({ path: sheet.path, scope: 'range', focus: { range: 'B2:C4' } })
    focus.setOpenFiles([sheet], sheet.path)
    expect(focus.capture().map(file => file.path)).toEqual([sheet.path])
    focus.setOpenFiles([ppt, sheet], ppt.path)
    expect(focus.current()?.focus).toBeUndefined()
  })

  it('keeps a fixed page across navigation and refreshes only its file version', () => {
    const focus = new OfficeFocusController()
    focus.setOpenFiles([ppt, sheet], ppt.path)
    focus.updateLocation(ppt.path, { page: 2, part: 'ppt/slides/slide2.xml', shapeIds: ['7'] })
    const pin = fileFocusReference(focus.current(), 'page', true)!
    focus.updateLocation(ppt.path, { page: 4, part: 'ppt/slides/slide4.xml', shapeIds: [] })
    focus.setOpenFiles([{ ...ppt, fileVersion: 'v2', bindingVersion: 2 }, sheet], sheet.path)
    const captured = captureFileContext(focus.capture(), [pin], new Set())
    expect(captured.references).toEqual([{ ...pin, fileVersion: 'v2', bindingVersion: 2 }, fileFocusReference(focus.current())])
    expect(captured.references[0]!.focus).toEqual({ page: 2, part: 'ppt/slides/slide2.xml' })
  })

  it('suppresses a removed automatic reference for one input without losing focus', () => {
    const focus = new OfficeFocusController()
    focus.setOpenFiles([ppt], ppt.path)
    focus.updateLocation(ppt.path, { page: 1, part: 'ppt/slides/slide1.xml', shapeIds: ['3'] })
    const reference = captureFileContext(focus.capture(), [], new Set()).references[0]!
    const removed = new Set([fileReferenceIdentity(reference)])
    expect(captureFileContext(focus.capture(), [], removed).references).toEqual([])
    expect(focus.current()?.focus?.shapeIds).toEqual(['3'])
    removed.clear() // accepted message starts the next input
    expect(captureFileContext(focus.capture(), [], removed).references).toEqual([reference])
    expect(fileFocusReference(focus.current(), 'object', true)?.pinned).toBe(true)
  })

  it('makes explicit file references available without exposing other files as writable', () => {
    const focus = new OfficeFocusController()
    focus.setOpenFiles([ppt, sheet], ppt.path)
    const context = captureFileContext(focus.capture(), [fileFocusReference(focus.current(), 'file', true)!], new Set())
    expect(executionFileContextSchema.safeParse(context).success).toBe(true)
    expect(context.openFiles).toHaveLength(2)
    expect(context.references).toHaveLength(1)
    expect(executionFileContextSchema.safeParse({ ...context, writeScope: [sheet.path] }).success).toBe(false)
    expect(formatExecutionFileContext(context)).toContain('不授予写入权限')
    const request = executionDesktopRequestSchema.parse({ type: 'send', workspaceId: 'w', conversationId: 'c',
      submissionId: 'b249603b-3aa1-450a-9ee3-9cc2c2af4398', expectedRevision: 1, text: '修改预算工作表 B2', documents: [],
      fileContext: context, permission: 'read-only' })
    expect(request.type === 'send' && request.fileContext).toEqual(context)
    expect(request.type === 'send' && request.documents).toEqual([])
  })

  it('refreshes prepared bytes without switching a submitted target during navigation', () => {
    const focus = new OfficeFocusController()
    focus.setOpenFiles([ppt, sheet], ppt.path)
    focus.updateLocation(ppt.path, { page: 2, part: 'ppt/slides/slide2.xml', shapeIds: ['7'] })
    const captured = captureFileContext(focus.capture(), [], new Set())
    focus.setOpenFiles([{ ...ppt, fileVersion: 'v2', bindingVersion: 2 }, sheet], sheet.path)
    focus.updateLocation(ppt.path, { page: 3, part: 'ppt/slides/slide3.xml', shapeIds: ['8'] })
    const submitted = refreshFileContextVersions(captured, focus.capture())
    expect(submitted.references[0]).toMatchObject({ path: ppt.path, fileVersion: 'v2', focus: { page: 2, shapeIds: ['7'] } })
    expect(submitted.openFiles.find(file => file.active)?.path).toBe(ppt.path)
  })

  it('publishes a completed save synchronously and rejects older or unrelated bindings', () => {
    const focus = new OfficeFocusController()
    focus.setOpenFiles([ppt, sheet], ppt.path)
    focus.updateLocation(ppt.path, { page: 2, part: 'ppt/slides/slide2.xml', shapeIds: ['7'] })
    const captured = captureFileContext(focus.capture(), [], new Set())
    const before = focus.readVersion()
    expect(focus.updateBinding(ppt.path, { path: ppt.path, fileVersion: 'v2', bindingVersion: 2 })).toBe(true)
    expect(focus.readVersion()).toBe(before + 1)
    expect(refreshFileContextVersions(captured, focus.capture()).references[0]).toMatchObject({ fileVersion: 'v2', focus: { page: 2, shapeIds: ['7'] } })
    focus.setOpenFiles([ppt, sheet], ppt.path) // delayed render still contains v1
    expect(focus.current()?.fileVersion).toBe('v2')
    expect(focus.updateBinding(ppt.path, { path: ppt.path, fileVersion: 'v1', bindingVersion: 1 })).toBe(false)
    expect(focus.updateBinding(ppt.path, { path: sheet.path, fileVersion: 'x2', bindingVersion: 3 })).toBe(false)
    expect(focus.current()?.focus?.shapeIds).toEqual(['7'])
    focus.setOpenFiles([sheet], sheet.path)
    expect(focus.updateBinding(ppt.path, { path: ppt.path, fileVersion: 'v3', bindingVersion: 4 })).toBe(false)
    expect(focus.capture().map(file => file.path)).toEqual([sheet.path])
  })

  it('keeps a fixed native page with the automatic page after navigation', () => {
    const fixed: ExecutionDocumentReference = { documentId: 'glx', epoch: 'e', revision: 1, writable: [{ kind: 'document' }],
      referenceId: 'glx:page:one', pinned: true, selection: [{ kind: 'course-surface', surfaceId: 'one' }] }
    const automatic: ExecutionDocumentReference = { ...fixed, referenceId: 'glx:page:two', pinned: false, selection: [{ kind: 'course-surface', surfaceId: 'two' }] }
    expect(mergeAutomaticReferences([fixed, automatic], [automatic])).toEqual([fixed, automatic])
    expect(mergeAutomaticReferences([fixed], [])).toEqual([fixed])
    expect(mergeAutomaticReferences([], [automatic])).toEqual([automatic])
  })

  it('does not duplicate the current Office target when it is fixed', () => {
    const focus = new OfficeFocusController()
    focus.setOpenFiles([ppt], ppt.path)
    const pin = fileFocusReference(focus.current(), 'file', true)!
    expect(captureFileContext(focus.capture(), [pin], new Set()).references).toEqual([pin])
  })
})

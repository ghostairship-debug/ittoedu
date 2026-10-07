// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { readEditableTargetContent } from '../../../../src/core/tools/ToolTargets'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData, createFormulaComponentData, type TextComponentData } from '../../../../src/components/text/data'

it('a software-bound V10 rich selection preserves unselected links marks geometry and unchanged formula identity in one History', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t01-rich-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('内容请求')
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const original = createTextComponentData({ inlines: [
      { type: 'text', text: '保留', style: { italic: true }, link: { href: './前文.html' } },
      { type: 'text', text: '旧', style: { bold: true }, link: { href: 'https://example.org/old' } },
      createFormulaComponentData('old-formula', 'x^2').formula,
      { type: 'text', text: '尾段', style: { color: '#123456' }, link: { href: 'tel:+8612345678' } },
    ] })
    const frame = { width: 330, height: 100, transform: [1, 0, 0, 1, 41, 63] as [number, number, number, number, number, number] }
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: original, frame, style: { opacity: .8 } }
    project.surfaces[0].childIds = ['text']
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'rich.h5lesson')
    const target = { kind: 'course-instance' as const, surfaceId: project.surfaces[0].id, instanceId: 'text', dataPath: ['content'], from: 2, to: 4 }
    const content = readEditableTargetContent(initial.model, target)
    expect(content.format).toBe('html')
    expect(content.text).toContain('https://example.org/old')
    expect(content.text).not.toContain('old-formula')
    expect(content.text).not.toContain('保留')
    await host.tools.beginRun({ runId: 'rich', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [target] }] })
    const handle = await host.tools.issueTarget('rich', initial.documentId, target)
    const replacement = '<a href="https://example.org/new"><strong>新</strong></a>\\(x^2\\)与\\(y\\)'
    expect(await host.tools.applyBoundContent('rich', 'content-result', handle, replacement))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const current = await host.internalAPI.read(initial.documentId)
    expect(current.undoDepth).toBe(1)
    if (current.model.kind !== 'course-v10') throw new Error('V10 required')
    const instance = current.model.project.instances.text
    expect(instance.frame).toEqual(frame)
    expect(instance.style).toEqual(project.instances.text.style)
    const inlines = (instance.data as TextComponentData).content.inlines
    expect(inlines[0]).toEqual(original.content.inlines[0])
    expect(inlines.at(-1)).toEqual(original.content.inlines.at(-1))
    expect(inlines).toContainEqual({ type: 'text', text: '新', style: { bold: true }, link: { href: 'https://example.org/new' } })
    const formulas = inlines.filter(value => value.type === 'math')
    expect(formulas.find(value => value.latex === 'x^2')?.formulaId).toBe('old-formula')
    expect(formulas.find(value => value.latex === 'y')?.formulaId).toBeTruthy()
    expect(formulas.find(value => value.latex === 'y')?.formulaId).not.toBe('old-formula')
    expect(await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      actor: 'human', operationId: 'undo', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ model: { project: { instances: { text: { data: original } } } } })
  } finally { await host.tools.stop('rich'); await fs.rm(directory, { recursive: true, force: true }) }
})

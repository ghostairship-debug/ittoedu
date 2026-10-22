import { describe, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import type { DocumentContextSelection, ContextualEditTarget } from '../../src/shared/document/ports'
import { freezeContextualEditTarget, validateContextualEditTarget } from '../../src/shared/document/contextualEditTarget'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { captureFlowSelection, captureMarkdownSelection } from '../../src/renderer/workbench/SelectionContextController'
import { setRootContainers, testContainerInstance } from '../helpers/glxWorkFixture'

function markdownSnapshot(): DocumentSnapshot {
  return { documentId: 'md', epoch: 'epoch', revision: 0, model: new MarkdownDriver().load(new TextEncoder().encode('甲乙丙丁')),
    binding: { kind: 'untitled', suggestedName: '未保存.md' }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}

describe('semantic layout context and materialized file targets remain distinct', () => {
  it('captures a precise Flow text range without requiring serialized source or source-map offsets', () => {
    const project = createBlankCourseProjectV10('Flow context')
    setRootContainers(project, [{ ...componentSurfaces(project)[0], kind: 'flow' }])
    const flow = testContainerInstance(project, 0)
    flow.childIds = ['body']
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('甲乙丙丁'))) }
    const base = markdownSnapshot()
    const snapshot: DocumentSnapshot = { ...base, documentId: 'flow', model: { kind: 'course-v10', project, resources: base.model.resources } }
    const target: DocumentContextSelection = { mode: 'layout', revision: '0', label: '所选两字', selection: { kind: 'text', revision: '0',
      anchor: { blockId: 'body', slot: { kind: 'field', field: 'content' }, offset: 1, affinity: 'after' },
      head: { blockId: 'body', slot: { kind: 'field', field: 'content' }, offset: 3, affinity: 'before' } } }
    expect(captureFlowSelection(snapshot, flow.id, target).targets).toEqual([{ kind: 'course-instance', surfaceId: flow.id, instanceId: 'body', stateId: null, dataPath: ['content'], from: 1, to: 3 }])
    expect(() => captureMarkdownSelection(base, target)).toThrow('选区已改变')
  })

  it('requires exact materialized source for a file capture and freezes its source ranges independently', () => {
    const snapshot = markdownSnapshot()
    const model = snapshot.model
    if (model.kind !== 'markdown') throw new Error('Expected a Markdown fixture')
    const target: ContextualEditTarget = { mode: 'layout', revision: '0', selection: null, label: '所选文字', source: model.source,
      ranges: [{ from: 1, to: 3, before: '乙丙' }], ref: { kind: 'file', path: 'D:/workspace/document.md' },
      baseVersion: { contentVersion: 'version-1', attachments: [] }, epoch: 1, scope: 'selection' }
    const frozen = freezeContextualEditTarget(target)
    target.ranges![0].from = 0
    expect(frozen.ranges).toEqual([{ from: 1, to: 3, before: '乙丙' }])
    expect(captureMarkdownSelection(snapshot, frozen).targets).toEqual([{ kind: 'markdown-range', from: 1, to: 3 }])
    expect(() => validateContextualEditTarget(frozen, { ref: frozen.ref, source: model.source, version: frozen.baseVersion, epoch: 1 })).not.toThrow()
    expect(() => validateContextualEditTarget(frozen, { ref: frozen.ref, source: 'changed', version: frozen.baseVersion, epoch: 1 })).toThrow('当前文档已改变')
  })
})

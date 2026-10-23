// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import type { ComponentDiscoveryEntry } from '../../src/shared/componentDiscovery'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { appendRootContainers } from '../helpers/glxWorkFixture'

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected course project')
  return snapshot.model
}
function data<T>(result: ToolResult): T {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' })
  if (result.kind !== 'read') throw new Error('Expected read result')
  return result.data as T
}

it('executes discovered Flow body actions through the real Main Gateway while preserving neighbors and one Undo', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-flow-body-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('正文发现')
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    for (const [id, text, color] of [['left', '左邻保留', '#123456'], ['right', '右邻保留', '#654321']] as const) {
      const original = createTextComponentData()
      project.instances[id] = { id, definitionId: TEXT_DEFINITION.id,
        data: { ...original, appearance: { ...original.appearance, color }, content: { inlines: [{ type: 'text', text }] } } }
    }
    appendRootContainers(project, { id: 'flow', kind: 'flow', title: '讲义', childIds: ['left', 'right'] })
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'discovery.glx')
    await host.tools.beginRun({ runId: 'body', actor: 'agent',
      documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: directory } })
    await host.tools.loadToolFamilies('body', ['content'])
    let serial = 0
    const tool = (name: string, input: unknown) => host.tools.execute('body', `call-${++serial}`, { name, input })
    const entries = data<{ entries: ComponentDiscoveryEntry[] }>(await tool('asset.search', { query: '标题 引用 列表 代码 分隔线 提示框 折叠节', limit: 100 })).entries
    const kinds = ['heading', 'quote', 'list', 'code', 'divider', 'callout', 'section']
    const actions = kinds.map(kind => entries.find(entry => entry.id === kind)!.action)
    for (const action of actions) expect(action).toMatchObject({ tool: 'project.apply', input: { intent: 'content' } })

    const listing = data<{ files: { path: string }[] }>(await tool('project.list', {}))
    const bodyPath = listing.files.find(file => file.path.endsWith('.body.html'))!.path
    const body = data<{ content: string }>(await tool('project.read', { path: bodyPath, full: true }))
    expect(body.content.match(/<\/body>/g)).toHaveLength(1)
    const fragments = actions.map(action => {
      const edit = (action.input as { edits: { old: string; new: string }[] }).edits[0]
      expect(edit.old).toBe('</body>')
      expect(edit.new.endsWith('</body>')).toBe(true)
      return edit.new.slice(0, -'</body>'.length)
    })
    const applied = await tool(actions[0].tool!, { path: bodyPath, intent: 'content',
      edits: [{ old: '</body>', new: `${fragments.join('\n')}</body>` }] })
    expect(applied, JSON.stringify(applied)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const current = await host.internalAPI.read(initial.documentId), next = course(current)
    const before = course(initial)
    expect(next.project.instances.left).toEqual(before.project.instances.left)
    expect(next.project.instances.right).toEqual(before.project.instances.right)
    const blocks = projectFlowDocument(next.project, 'flow').content.blocks
    expect(blocks.map(block => block.type)).toEqual(['paragraph', 'paragraph', ...kinds])
    expect(blocks.slice(0, 2).map(block => block.id)).toEqual(['left', 'right'])
    expect(blocks.at(-1)).toMatchObject({ type: 'section', collapsedByDefault: false, blocks: [{ type: 'paragraph' }] })
    expect(current.undoDepth).toBe(initial.undoDepth + 1)
    await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      actor: 'human', operationId: 'undo-body-insertion', mutation: { type: 'undo' } })
    expect(course(await host.internalAPI.read(initial.documentId))).toEqual({ ...before,
      project: { ...before.project, revision: next.project.revision + 1 } })
  } finally {
    await host.tools.stop('body')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

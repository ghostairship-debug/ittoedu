// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { createTextComponentData } from '../../../../src/components/text/data'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { jsonValueSchema } from '../../../../src/shared/contracts/component-platform/schema'
import { BundledSkillService } from '../../../../src/main/workbench/skills/BundledSkillService'

it('executes an authorized V10 property edit without tools.load and preserves the frozen range authority', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t02-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  let rangeStarted = false
  try {
    const project = createBlankCourseProjectV10('自动能力')
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.instances.title = { id: 'title', definitionId: TEXT_DEFINITION.id, data: jsonValueSchema.parse(createTextComponentData('标题')),
      frame: { width: 250, height: 90, transform: [1, 0, 0, 1, 30, 40] } }
    project.surfaces[0].childIds = ['title']
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'capability.h5lesson')
    const target = { kind: 'course-instance' as const, surfaceId: project.surfaces[0].id, instanceId: 'title' }
    await host.tools.beginRun({ runId: 'whole', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [target] }] })
    const handle = await host.tools.issueTarget('whole', initial.documentId, target)
    expect(await host.tools.execute('whole', 'property', { name: 'object.update', input: { target: handle, properties: { label: '教师改名', opacity: .6 } } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const current = await host.internalAPI.read(initial.documentId)
    expect(current).toMatchObject({ undoDepth: 1, model: { kind: 'course-v10', project: { instances: { title: { name: '教师改名', style: { opacity: .6 }, frame: project.instances.title.frame, data: project.instances.title.data } } } } })
    const range = { ...target, dataPath: ['content'], from: 0, to: 1 }
    await host.tools.beginRun({ runId: 'range', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [range] }] })
    rangeStarted = true
    const rangeHandle = await host.tools.issueTarget('range', initial.documentId, range)
    const denied = await host.tools.execute('range', 'cannot-widen', { name: 'object.update', input: { target: rangeHandle, properties: { label: '越界' } } })
    expect(denied.kind).toBe('error')
    expect((await host.internalAPI.read(initial.documentId)).revision).toBe(current.revision)
  } finally { await host.tools.stop('whole'); if (rangeStarted) await host.tools.stop('range'); await fs.rm(directory, { recursive: true, force: true }) }
})

it('reading a Chinese teaching method keeps ordinary read inspect and original read-only authority', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t02-method-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const initial = await host.internalAPI.create({ kind: 'markdown', source: '教师原稿', resources: { assets: {}, components: {} } }, 'notes.md')
    host.tools.configureHostServices({ skills: new BundledSkillService({ manifest: { skills: [{ name: 'orchestrate-courseware', description: '教学创作方法',
      path: 'skills/orchestrate-courseware/SKILL.md', references: [], version: 'one' }] }, files: { 'skills/orchestrate-courseware/SKILL.md': '先确定教学主线，然后组织内容。' } }) })
    await host.tools.beginRun({ runId: 'method', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [] }],
      fileAccess: { permission: 'read-only', workspaceRoot: directory } })
    const handle = await host.tools.issueTarget('method', initial.documentId, { kind: 'document' })
    const before = (await host.tools.describeRun('method')).map(tool => tool.name)
    expect(before).toEqual(expect.arrayContaining(['read', 'inspect']))
    expect(await host.tools.execute('method', 'read-method', { name: 'skills.read', input: { skill: 'orchestrate-courseware' } }))
      .toMatchObject({ kind: 'read', data: { content: '先确定教学主线，然后组织内容。' } })
    const after = (await host.tools.describeRun('method')).map(tool => tool.name)
    expect(after).toEqual(expect.arrayContaining(['read', 'inspect']))
    expect(await host.tools.execute('method', 'read-again', { name: 'read', input: { target: handle } })).toMatchObject({ kind: 'read' })
    expect(await host.tools.execute('method', 'inspect-again', { name: 'inspect', input: { target: handle } })).toMatchObject({ kind: 'read' })
    expect(await host.tools.execute('method', 'cannot-write', { name: 'text.replace', input: { target: handle, content: '不应写入' } })).toMatchObject({ kind: 'error' })
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ revision: 0, model: { source: '教师原稿' } })
  } finally { await host.tools.stop('method'); await fs.rm(directory, { recursive: true, force: true }) }
})

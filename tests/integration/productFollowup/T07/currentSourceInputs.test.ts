// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../../../src/core/projectFiles/componentPlatform'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'

it('software-produced long V10 object paths remain readable and editable without caller-owned IDs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t07-path-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('当前工程')
    project.surfaces[0].title = '教学页面'.repeat(70)
    project.definitions.text = { ...TEXT_DEFINITION, id: 'text', title: '课堂文本'.repeat(70) }
    const frame = { width: 200, height: 80, transform: [1, 0, 0, 1, 25, 30] as [number, number, number, number, number, number] }
    project.instances.content = { id: 'content', definitionId: 'text', data: createTextComponentData('保留正文'), frame }
    project.surfaces[0].childIds = ['content']
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'source.h5lesson')
    await host.tools.beginRun({ runId: 'paths', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }] })
    await host.tools.loadToolFamilies('paths', ['content', 'layout'])
    const file = componentProjectFiles(project, initial.model.resources).find(value => value.kind === 'data' && value.target?.kind === 'instance')!
    expect(file.path.length).toBeGreaterThan(500)
    expect(await host.tools.execute('paths', 'read', { name: 'project.read', input: { path: file.path } })).toMatchObject({ kind: 'read' })
    const edited = await host.tools.execute('paths', 'edit', { name: 'object.update', input: { path: file.path, properties: { opacity: .7 } } })
    expect(edited, JSON.stringify(edited))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const current = await host.internalAPI.read(initial.documentId)
    expect(current).toMatchObject({ undoDepth: 1, model: { kind: 'course-v10', project: { instances: { content: { data: project.instances.content.data, frame, style: { opacity: .7 } } } } } })
  } finally { await host.tools.stop('paths'); await fs.rm(directory, { recursive: true, force: true }) }
})

it('phone and ordinary relative links survive a local Flow content revision and real save cold reopen', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t07-links-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('链接正文')
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const data = createTextComponentData({ inlines: [
      { type: 'text', text: '电话', link: { href: 'tel:+8612345678' } },
      { type: 'text', text: ' 原稿 ' },
      { type: 'text', text: '参考', link: { href: './资料/讲义.html#练习', title: '课内参考' } },
    ] })
    project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data }
    project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: ['body'] })
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'links.h5lesson')
    await host.tools.beginRun({ runId: 'links', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }] })
    await host.tools.loadToolFamilies('links', ['content'])
    const file = componentProjectFiles(project, initial.model.resources).find(value => value.binding?.kind === 'flow' && value.binding.format === 'markdown')!
    await host.tools.execute('links', 'read', { name: 'project.read', input: { path: file.path } })
    expect(await host.tools.execute('links', 'edit', { name: 'project.apply', input: { path: file.path, content: file.content!.replace('原稿', '修订') } }))
      .toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const filename = path.join(directory, 'links-saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)
    expect(reopened).toMatchObject({ model: { kind: 'course-v10', project: { instances: { body: { data: { content: { inlines: [
      data.content.inlines[0], { type: 'text', text: ' 修订 ' }, data.content.inlines[2],
    ] } } } } } } })
  } finally { await host.tools.stop('links'); await fs.rm(directory, { recursive: true, force: true }) }
})

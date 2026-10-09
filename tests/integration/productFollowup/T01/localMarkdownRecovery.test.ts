// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../../../src/core/projectFiles/componentPlatform'
import { TEXT_DEFINITION , textDataEdit } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'

it('a locally unsupported Markdown table retains the neighboring live Flow object and recoverable original source', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t01-local-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('局部诊断')
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
    project.instances.paragraph = { id: 'paragraph', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', createTextComponentData('可用正文')).value }
    project.instances.interaction = { id: 'interaction', definitionId: 'web', data: { html: '<details><summary>问答</summary>答案</details>' },
      frame: { width: 300, height: 130, transform: [1, 0, 0, 1, 20, 30] } }
    project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: ['paragraph', 'interaction'] })
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'local.h5lesson')
    await host.tools.beginRun({ runId: 'local', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }] })
    await host.tools.loadToolFamilies('local', ['content'])
    const file = componentProjectFiles(project, initial.model.resources).find(value => value.binding?.kind === 'flow' && value.binding.format === 'markdown')!
    await host.tools.execute('local', 'read', { name: 'project.read', input: { path: file.path } })
    const markdown = file.content! + '\n\n| 问题 | 回答 |\n| :--- | ---: |\n| 一加一 | 二 |\n'
    expect(await host.tools.execute('local', 'apply', { name: 'project.apply', input: { path: file.path, content: markdown } }))
      .toMatchObject({ kind: 'read', data: { commit: 'committed', diagnostics: expect.arrayContaining([expect.objectContaining({ repairable: true })]) } })
    const filename = path.join(directory, 'saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)
    if (reopened.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(reopened.model.project.instances.interaction).toEqual(project.instances.interaction)
    expect(reopened.model.project.instances.paragraph).toEqual(project.instances.paragraph)
    expect(reopened.model.project.surfaces.find(value => value.id === 'flow')?.childIds).toEqual(expect.arrayContaining(['paragraph', 'interaction']))
    expect(Object.values(reopened.model.resources.assets).map(bytes => new TextDecoder().decode(bytes))).toContain(markdown)
  } finally { await host.tools.stop('local'); await fs.rm(directory, { recursive: true, force: true }) }
})

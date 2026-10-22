// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { componentContainerBuiltinKey, createComponentContainerInstance } from '../../src/shared/contracts/component-platform/project'
import { TEXT_DEFINITION, textDataEdit } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import type { ToolResult } from '../../src/shared/workbench/tools'

const limit = 128
const html = `<main><h1>LOCAL BODY</h1><p>${'Only this selected program body. '.repeat(24)}</p></main>`
const source = `export default { mount(context) { const root = document.createElement('main'); root.textContent = 'LOCAL SOURCE'; context.host.append(root); return { update() {}, dispose() { root.remove() } } } };\n${'// This source belongs only to the selected program.\n'.repeat(12)}`
const readData = (result: ToolResult) => {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as { path: string; content: string; total: number; nextOffset: number }
}

it('keeps real project.read body and Source payloads local at one and 500 work roots', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-local-read-scale-'))
  const facts: Array<Record<string, unknown>> = []
  try {
    for (const rootCount of [1, 500]) {
      let id = 0
      const project = createBlankProgramProject('Selected program', () => `local-${++id}`), targetId = project.entry!.rootInstanceId
      project.instances[targetId].data = { html }
      project.definitions[project.instances[targetId].definitionId].implementation = { kind: 'source', language: 'javascript', source }
      if (rootCount > 1) {
        const definitionId = componentContainerBuiltinKey('slide')
        project.definitions[definitionId] = { id: definitionId, role: 'mixed', title: 'Unrelated container', implementation: { kind: 'builtin', key: definitionId } }
        for (let index = 1; index < rootCount; index++) {
          const rootId = `unrelated-${index}`
          project.rootIds.push(rootId)
          project.instances[rootId] = createComponentContainerInstance({ id: rootId, kind: 'slide', title: `UNRELATED_ROOT_${index}`,
            childIds: [], designSize: { width: 1280, height: 720 } }, definitionId)
        }
        project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
        project.instances.unrelatedText = { id: 'unrelatedText', definitionId: TEXT_DEFINITION.id,
          data: textDataEdit('unrelatedText', createTextComponentData('UNRELATED_BODY_MUST_NOT_BE_RETURNED')).value }
        project.instances['unrelated-499'].childIds!.push('unrelatedText')
      }
      const host = new DocumentHostService(path.join(directory, String(rootCount)))
      const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'local-read.glx')
      await host.tools.beginRun({ runId: 'read', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [] }] })
      try {
        const selector = await host.tools.issueTarget('read', initial.documentId, { kind: 'course-instance', surfaceId: targetId, instanceId: targetId })
        const files = componentProjectFiles(project, { assets: {}, components: {} })
        const bodyPath = files.find(file => file.kind === 'html' && file.path.endsWith('.content.html') && file.target?.kind === 'instance' && file.target.instanceId === targetId)!.path
        const sourcePath = files.find(file => file.kind === 'source' && file.target?.kind === 'instance' && file.target.instanceId === targetId)!.path
        const body = readData(await host.tools.execute('read', 'body', { name: 'project.read', input: { project: selector, path: bodyPath, limit } }))
        const implementation = readData(await host.tools.execute('read', 'source', { name: 'project.read', input: { project: selector, path: sourcePath, limit } }))
        const listing = await host.tools.execute('read', 'list', { name: 'project.list', input: { project: selector, limit: 100 } })
        if (listing.kind !== 'read') throw new Error(JSON.stringify(listing))
        const listed = listing.data as { files: { path: string }[]; total: number }
        expect(body.content).toBe(html.slice(0, limit))
        expect(implementation.content).toBe(source.slice(0, limit))
        expect(JSON.stringify([body, implementation, listed])).not.toMatch(/UNRELATED_ROOT_|UNRELATED_BODY_/)
        expect(body.content.length).toBe(limit); expect(implementation.content.length).toBe(limit)
        facts.push({ rootCount, instanceCount: Object.keys(project.instances).length, limit,
          body: { path: body.path, characters: body.content.length, total: body.total, nextOffset: body.nextOffset },
          source: { path: implementation.path, characters: implementation.content.length, total: implementation.total, nextOffset: implementation.nextOffset },
          localFileCount: listed.total, localPaths: listed.files.map(file => file.path),
        })
      } finally { await host.tools.stop('read') }
    }
    const [small, large] = facts
    expect(large).toEqual({ ...small, rootCount: 500, instanceCount: 501 })
    console.info(`GLX_LOCAL_READ_FACTS ${JSON.stringify(facts)}`)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

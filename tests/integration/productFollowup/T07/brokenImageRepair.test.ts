// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { ContentApplyService } from '../../../../src/main/workbench/contentApply/applyService'
import { InMemoryComponentCompilation } from '../../../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { HTML_PROGRAM_DEFINITION } from '../../../../src/components/web/data'

it('broken image original bytes survive V10 save cold reopen and can be repaired without replacing the live program or frame', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t07-image-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('失效图片修复')
    project.definitions[HTML_PROGRAM_DEFINITION.id] = HTML_PROGRAM_DEFINITION
    const frame = { width: 300, height: 160, transform: [1, 0, 0, 1, 38, 49] as [number, number, number, number, number, number] }
    project.instances.program = { id: 'program', definitionId: HTML_PROGRAM_DEFINITION.id, data: { html: '<p>旧正文</p>' }, frame }
    project.surfaces[0].childIds = ['program']
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'image.h5lesson')
    const measure = vi.fn(async () => { throw new Error('Local content edit must not remeasure the authored frame') })
    const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    const service = new ContentApplyService({ measure, compilation, session: { project: () => project, resources: () => initial.model.resources,
      dispatch: command => host.internalAPI.dispatch({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision,
        operationId: 'image-content', actor: 'agent', mutation: { type: 'command', command } }) } })
    const originalBytes = Uint8Array.of(137, 80, 78, 71, 0, 255, 1)
    const html = '<p>可用正文</p><img src="./broken.png"><button onclick="this.textContent=\'完成\'">运行按钮</button>'
    const applied = await service.apply({ intent: 'content', target: { kind: 'instance', instanceId: 'program' },
      source: { kind: 'html', html, siblingFiles: new Map([['broken.png', originalBytes]]) } })
    expect(applied.commit).toBe('committed')
    expect(applied.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'image-resource-unavailable', repairable: true })]))
    expect(measure).not.toHaveBeenCalled()
    const filename = path.join(directory, 'saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const cold = new DocumentHostService(path.join(directory, 'cold'))
    const reopened = await cold.internalAPI.open(filename)
    if (reopened.model.kind !== 'course-v10') throw new Error('V10 required')
    const assets = reopened.model.resources.assets
    const retainedId = Object.keys(assets).find(id => assets[id].length === originalBytes.length && assets[id].every((byte, index) => byte === originalBytes[index]))
    expect(retainedId).toBeTruthy()
    const program = reopened.model.project.instances.program
    expect(program.frame).toEqual(frame)
    expect(program.data).toMatchObject({ html: expect.stringContaining('onclick=') })
    expect(Object.values((program.data as { resourceBindings: Record<string, string> }).resourceBindings)).toContain(retainedId)
    const asset = reopened.model.project.assets[retainedId!]
    await fs.writeFile(path.join(directory, 'repair.png'), await sharp({ create: { width: 8, height: 6, channels: 4, background: '#3366cc' } }).png().toBuffer())
    await cold.tools.beginRun({ runId: 'repair', actor: 'agent', documents: [{ documentId: reopened.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: directory } })
    await cold.tools.loadToolFamilies('repair', ['content'])
    await cold.tools.execute('repair', 'read', { name: 'project.read', input: { path: asset.path } })
    expect(await cold.tools.execute('repair', 'repair', { name: 'project.apply', input: { path: asset.path, from: 'repair.png' } }))
      .toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const repaired = await cold.internalAPI.read(reopened.documentId)
    expect(repaired).toMatchObject({ model: { project: { assets: { [retainedId!]: { width: 8, height: 6 } }, instances: { program: { frame, data: program.data } } } } })
    await cold.tools.stop('repair')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

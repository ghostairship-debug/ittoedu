// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'

it('authors once into an initially empty formal global container and preserves it through save and cold reopen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'global-authoring-'))
  try {
    const host = new DocumentHostService(path.join(root, 'recovery'))
    const project = createBlankCourseProjectV10('全局导航载体')
    const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'global.glx')
    await host.tools.beginRun({ runId: 'author', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }] }] })
    const file = componentProjectFiles(project, snapshot.model.kind === 'course-v10' ? snapshot.model.resources : { assets: {}, components: {} })
      .find(file => file.path === 'global/overlay.json')!
    expect(file).toMatchObject({ kind: 'structure', target: { kind: 'container', container: { kind: 'global', plane: 'overlay' } } })
    expect(await host.tools.execute('author', 'read-global', { name: 'project.read', input: { path: file.path } })).toMatchObject({ kind: 'read' })
    const applied = await host.tools.execute('author', 'insert-global', { name: 'project.apply', input: {
      path: file.path, intent: 'insert', content: '<button>继续</button><script>window.fixtureNavigation=true</script>',
      region: { width: 320, height: 60, transform: [1, 0, 0, 1, 0, 600] },
    } })
    expect(applied, JSON.stringify(applied)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const current = await host.internalAPI.read(snapshot.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected formal project')
    expect(current.model.project.global.overlay).not.toHaveLength(0)
    expect(componentSurfaces(current.model.project)).toEqual(componentSurfaces(project))
    const page = componentProjectFiles(current.model.project, current.model.resources).find(file => file.kind === 'structure' && file.path.startsWith('pages/'))!
    const context = await host.tools.taskTargetContext('author', { path: page.path })
    expect(context).toMatchObject({ neighbors: expect.arrayContaining([expect.objectContaining({ coordinates: 'global-overlay',
      frame: { width: 320, height: 60, transform: [1, 0, 0, 1, 0, 600] } })]) })
    const filename = path.join(root, 'global.glx')
    await host.internalAPI.save(snapshot.documentId, filename)
    const reopened = await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename)
    if (reopened.model.kind !== 'course-v10') throw new Error('Expected reopened project')
    expect(reopened.model.project.global).toEqual(current.model.project.global)
    expect(reopened.model.project.instances).toEqual(current.model.project.instances)
    await host.tools.stop('author')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { HtmlImportDesktopService } from '../../src/main/workbench/htmlImport/HtmlImportDesktopService'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'

vi.mock('../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement.js', async () => {
  const { sourceProgramAssembly } = await import('../../src/core/contentApply/assembly/htmlAssembly')
  return { measureHtmlAtDesignViewport: async (input: { viewport: { width: number; height: number }; html: string }) =>
    sourceProgramAssembly(input.viewport, { html: input.html }, 'fixture-retained-program') }
})

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-html-anchor-')); roots.push(root)
  const source = path.join(root, 'lesson.html')
  await fs.writeFile(source, '<!doctype html><html><body><button>Imported interaction</button></body></html>')
  const object = (id: string, childIds?: string[]) => ({ id, definitionId: 'group', data: {}, ...(childIds ? { childIds } : {}) })
  const project: CourseProjectV11 = { schemaVersion: 11, id: 'anchors', revision: 0, title: 'HTML anchor scopes',
    rootIds: ['outer'], entry: { rootInstanceId: 'outer' },
    definitions: {
      flow: { id: 'flow', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
    },
    instances: {
      outer: { id: 'outer', definitionId: 'flow', data: {}, childIds: ['group', 'nested', 'sibling'], container: { kind: 'flow' } },
      group: object('group', ['group-anchor', 'group-tail']), 'group-anchor': object('group-anchor'), 'group-tail': object('group-tail'),
      nested: { id: 'nested', definitionId: 'flow', data: {}, childIds: ['nested-group'], container: { kind: 'flow' } },
      'nested-group': object('nested-group', ['nested-anchor', 'nested-tail']),
      'nested-anchor': object('nested-anchor'), 'nested-tail': object('nested-tail'),
      sibling: { id: 'sibling', definitionId: 'flow', data: {}, childIds: ['sibling-anchor'], container: { kind: 'flow' } },
      'sibling-anchor': object('sibling-anchor'), 'global-anchor': object('global-anchor'),
    }, global: { underlay: [], overlay: ['global-anchor'] }, assets: {} }
  const host = new DocumentHostService(path.join(root, 'journal'))
  const first = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'anchors.glx')
  const chooseSource = vi.fn(async () => source)
  const service = new HtmlImportDesktopService({ documents: host, chooseSource })
  const model = () => {
    const snapshot = host.registry.get(first.documentId).read()
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected component work')
    return snapshot
  }
  const request = (surfaceId: string, anchorInstanceId: string) => ({ documentId: first.documentId, epoch: first.epoch,
    revision: first.revision, surfaceId, anchorInstanceId, source: { kind: 'choose' as const }, viewport: { width: 640, height: 360 } })
  return { host, first, project, service, chooseSource, request, model }
}

for (const [surfaceId, anchorId, groupId, tailId] of [
  ['outer', 'group-anchor', 'group', 'group-tail'],
  ['nested', 'nested-anchor', 'nested-group', 'nested-tail'],
] as const) it(`imports after a grouped anchor in its selected ${surfaceId} container through the canonical writer`, async () => {
  const f = await fixture()
  const result = await f.service.import(f.request(surfaceId, anchorId))
  expect(result?.receipt.status).toBe('applied')
  const current = f.model()
  if (current.model.kind !== 'course-v10') throw new Error('Expected component work')
  const children = current.model.project.instances[groupId].childIds!
  expect(children[0]).toBe(anchorId)
  expect(children.at(-1)).toBe(tailId)
  expect(children).toHaveLength(3)
  expect(current.model.project.instances[children[1]].data).toMatchObject({ html: expect.stringContaining('Imported interaction') })
  for (const id of ['outer', 'nested', 'sibling']) expect(current.model.project.instances[id].childIds).toEqual(f.project.instances[id].childIds)
  expect(current.undoDepth).toBe(1)
  const undone = await f.host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: 'undo-import', actor: 'human', mutation: { type: 'undo' } })
  expect(undone.status).toBe('applied')
  expect(f.model().model).toMatchObject({ project: { instances: { [groupId]: { childIds: [anchorId, tailId] } } } })
})

it('rejects anchors across nested, sibling, outer and global scopes before choosing or applying a source', async () => {
  const f = await fixture(), before = f.model()
  for (const [surfaceId, anchorId] of [['outer', 'nested-anchor'], ['nested', 'group-anchor'],
    ['nested', 'sibling-anchor'], ['nested', 'nested'], ['outer', 'global-anchor'], ['outer', 'missing']] as const)
    await expect(f.service.import(f.request(surfaceId, anchorId))).rejects.toThrow('锚点不属于所选页面')
  expect(f.chooseSource).not.toHaveBeenCalled()
  expect(f.model()).toEqual(before)
})

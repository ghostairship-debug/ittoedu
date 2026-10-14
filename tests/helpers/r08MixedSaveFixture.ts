import path from 'node:path'
import fs from 'node:fs/promises'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'

export async function createR08MixedSavedFixture() {
  const directory = path.resolve(`output/authoring-playback-repair-20261012/mixed-save/${Date.now()}`)
  await fs.mkdir(directory, { recursive: true })
  const project = createBlankCourseProjectV10('共编与独立导航')
  project.surfaces = [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: [], designSize: { width: 1280, height: 720 } },
    { id: 'flow', kind: 'flow', title: 'Flow', childIds: [], flow: { layout: { readingWidth: 800, wideContentWidth: 1000, toc: 'hidden' } } },
    { id: 'spatial', kind: 'spatial', title: 'Spatial', childIds: [], spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } }]
  const source = `export default { mount({root, instance, teacherController: host, scope}) {
    let clicks=0; const node=document.createElement('div'); root.append(node);
    const render=()=>{node.innerHTML='<button id="move">移动 '+instance.id+'</button><button id="fold">折叠 '+instance.id+'</button><button id="next">下一页 '+instance.id+'</button><output>'+instance.data.label+' / '+host.read().locationId+' / '+!!host.read().collapsed+' / '+clicks+'</output>';
      node.querySelector('#move').onclick=()=>{clicks++;host.moveBy(40,20)};
      node.querySelector('#fold').onclick=()=>host.setCollapsed(!host.read().collapsed);
      node.querySelector('#next').onclick=()=>host.execute({type:'scene.next'});
    }; const off=host.subscribe(render); render(); scope.cleanup(off);
    return { update(next){instance=next;render()}, updatePlacement(){}, dispose(){off();node.remove()} };
  } }`
  project.definitions.control = { id: 'control', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
  for (const [id, y] of [['a', 40], ['b', 200]] as const) {
    project.instances[id] = { id, definitionId: 'control', viewportPinned: true, data: { label: '初稿' }, frame: { width: 400, height: 100, transform: [1, 0, 0, 1, 100, y] } }
    project.global.overlay.push(id)
  }
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '共编与独立导航')
  const edit = async (actor: 'human' | 'agent', edits: ComponentEdit[]) => {
    const current = await host.internalAPI.read(initial.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Missing current course')
    const result = await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: `${actor}-current`, actor, mutation: { type: 'command', command: captureComponentOperation(current.model.project, edits) } })
    if (result.status !== 'applied') throw new Error(JSON.stringify(result))
  }
  const manual = { width: 430, height: 110, transform: [1, 0, 0, 1, 130, 50] as [number, number, number, number, number, number] }
  await edit('human', [{ type: 'frame.set', instanceId: 'a', frame: manual }])
  await edit('agent', [{ type: 'data.set', instanceId: 'a', path: ['label'], value: 'AI 在人工布局上改文案' }])
  const filename = path.join(directory, '共编与独立导航.glx')
  await host.internalAPI.save(initial.documentId, filename)
  const cold = await new DocumentHostService(path.join(directory, 'cold')).open(filename)
  if (cold.model.kind !== 'course-v10') throw new Error('Wrong reopened format')
  if (JSON.stringify(cold.model.project.instances.a.frame) !== JSON.stringify(manual)) throw new Error('Manual geometry was not preserved')
  const compiler = createEsbuildComponentCompiler()
  const compiled = await buildPublishedCourseV3({ project: cold.model.project, assetBytes: cold.model.resources.assets, componentFiles: cold.model.resources.components },
    { compilation: { compile: async input => ({ ...await compiler.compile(input), source: input, cacheHit: false, durationMs: 0 }) } })
  if (compiled.diagnostics.length) throw new Error(JSON.stringify(compiled.diagnostics))
  await fs.writeFile(path.join(directory, 'published.json'), JSON.stringify(compiled.payload))
  await fs.writeFile(path.join(directory, 'save-evidence.json'), JSON.stringify({ revision: cold.revision, manual: cold.model.project.instances.a.frame,
    label: cold.model.project.instances.a.data, pinned: cold.model.project.instances.a.viewportPinned, flow: cold.model.project.surfaces[1].flow, sourcePreserved: cold.model.project.definitions.control.implementation.kind === 'source' }))
  return compiled.payload
}

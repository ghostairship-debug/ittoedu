import { ComponentPlatformRuntime } from '../../../src/player/components/ComponentPlatformRuntime'
import { prepareSandboxComponent } from '../../../src/renderer/components/SandboxComponentImplementation'
import { webContentRealmSource } from '../../../src/components/web/contentRealmImplementation'
import type { CourseProjectV10 } from '../../../src/shared/contracts/component-platform'

let world: ComponentPlatformRuntime | undefined
const errors: string[] = []
;(window as any).renderW3 = async (model: { project: CourseProjectV10; resources: any }) => {
  if (world) await world.dispose()
  document.body.replaceChildren(); document.body.style.cssText = 'margin:0;width:1280px;height:720px'
  const current = new ComponentPlatformRuntime('w3-real-carrier', { mode: 'play', report: message => errors.push(message),
    resolveBuiltin: (key, signal) => prepareSandboxComponent({ format: 'esm', code: webContentRealmSource(), css: '', diagnostics: [] }, signal,
      { builtinKey: key, state: () => current.stateSnapshot(), targets: () => current.targetSnapshots(), resources: () => current.resourceUrls(), htmlAuthoring: true }) })
  world = current
  const add = (id: string, parent: HTMLElement) => {
    const instance = model.project.instances[id]!, box = document.createElement('div'), frame = instance.frame!
    box.dataset.w3Instance = id
    box.style.cssText = `position:absolute;left:0;top:0;width:${frame.width}px;height:${frame.height}px;transform-origin:0 0;transform:matrix(${frame.transform.join(',')})`
    const projection = document.createElement('div')
    projection.style.cssText = 'width:100%;height:100%'
    box.append(projection); parent.append(box); current.bind(id, projection)
    for (const child of instance.childIds ?? []) add(child, box)
  }
  for (const id of model.project.surfaces[0]!.childIds) add(id, document.body)
  await current.sync(model.project, model.resources)
  return errors
}

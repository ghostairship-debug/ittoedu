import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { addCourseFlowPage, addCourseSpatialPage } from '@/core/tools/courseLocations'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { componentPackageMeta } from '@/shared/componentPackageMeta'
import { createDefaultTeacherControllerPackage } from '@/shared/defaultTeacherControllerComponent'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { ComponentLayerItem, CourseProjectDocument } from '@/shared/courseProjectTypes'
import { createPublishedCourseSession, type PublishedCourseSession } from '@/player/surfaces/publishedDynamicHosts'

const NOW = '2026-09-16T12:00:00.000Z'
const PACKAGE_ID = 'com.ittoedu.test.component-navigation'

function requireOk<T extends { ok: boolean; reason?: string }>(result: T): T & { ok: true } {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason ?? 'command failed')
  return result as T & { ok: true }
}

function navigationComponent(): ReturnType<typeof createDefaultTeacherControllerPackage> {
  const source = createDefaultTeacherControllerPackage()
  const manifest = { ...source.manifest, id: PACKAGE_ID, name: '导航合同组件', description: 'Published navigation contract fixture' }
  const runtimeSource = `window.CoursewareComponent.define({
  id: '${PACKAGE_ID}', runtimeApiVersion: 4,
  create(ctx) {
    const root = ctx.dom.root
    const add = (id, run) => {
      const button = document.createElement('button')
      button.dataset.componentNavigation = id
      button.textContent = id
      button.onclick = () => { window.__componentNavigationResult = id + ':' + String(run()) }
      root.appendChild(button)
    }
    add('wrong-location', () => ctx.actions.goToScene(ctx.props.flowLocationId))
    add('next', () => ctx.actions.nextScene())
    add('unlock', () => { ctx.courseState?.set('unlocked', true); return true })
    return { destroy() { root.replaceChildren() } }
  }
})`
  const files = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(runtimeSource),
  }
  return { ...source, manifest, runtimeSource, files, contentSha256: componentContentSha256(files) }
}

function mixedPublishedProject(): { project: CourseProjectDocument; component: ReturnType<typeof navigationComponent> } {
  let project = createBlankCourseProject({ now: NOW, includeDefaultController: false, controls: 'none' })
  project = requireOk(addCourseFlowPage(project, { now: NOW, expectedRevision: project.revision })).project
  project = requireOk(addCourseSpatialPage(project, { now: NOW, expectedRevision: project.revision })).project
  const flowLocation = project.locations.find(location => location.kind === 'flow-block')
  const spatialLocation = project.locations.find(location => location.kind === 'spatial-camera')
  if (!flowLocation || !spatialLocation) throw new Error('expected Flow and Spatial locations')
  const component = navigationComponent()
  const item: ComponentLayerItem = {
    layerItemId: 'component-navigation', label: '导航合同组件', kind: 'component',
    frame: { mode: 'absolute', x: 20, y: 20, width: 280, height: 72 }, order: 100,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    component: { packageId: component.manifest.id, version: component.manifest.version },
    props: { flowLocationId: flowLocation.id },
  }
  project = courseProjectDocumentSchema.parse({
    ...project,
    componentPackages: { ...project.componentPackages, [component.manifest.id]: componentPackageMeta(component) },
    globalLayerItems: [...project.globalLayerItems, { item, visibility: { mode: 'all', locationIds: [] } }],
  })
  return { project, component }
}

describe('Published component navigation contract', () => {
  const sessions: PublishedCourseSession[] = []

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map(session => session.destroy()))
  })

  it('rejects Flow locations from goToScene, crosses Surface order through nextScene, and keeps the current location when guarded', async () => {
    const { project, component } = mixedPublishedProject()
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: { [component.manifest.id]: component } })
    const flow = payload.locations.find(location => location.kind === 'flow-block')!
    const spatial = payload.locations.find(location => location.kind === 'spatial-camera')!
    payload.courseState = [{ key: 'unlocked', valueType: 'boolean', defaultValue: false }]
    payload.navigationGuards = [{
      id: 'block-flow', effect: 'block', toLocationIds: [flow.id], match: 'all',
      conditions: [{ type: 'compare', key: 'unlocked', operator: 'eq', value: false }], message: 'Flow 尚未解锁',
    }]
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)
    const button = (id: string) => {
      for (const host of container.querySelectorAll<HTMLElement>('.published-component-mount')) {
        if (host.closest<HTMLElement>('[data-course-surface-slot]')?.style.visibility === 'hidden') continue
        const value = host.shadowRoot?.querySelector<HTMLButtonElement>(`[data-component-navigation="${id}"]`)
        if (value) return value
      }
      throw new Error(`missing component action ${id}`)
    }
    const result = () => Reflect.get(window, '__componentNavigationResult')
    const location = () => session.navigator.current?.locationId

    expect(location()).toBe(payload.startLocationId)
    button('wrong-location').click()
    expect(result()).toBe('wrong-location:false')
    expect(location()).toBe(payload.startLocationId)

    button('next').click()
    await vi.waitFor(() => expect(location()).toBe(payload.startLocationId))
    expect(result()).toBe('next:false')

    button('unlock').click()
    button('next').click()
    await vi.waitFor(() => expect(location()).toBe(flow.id))
    expect(result()).toBe('next:true')

    button('next').click()
    await vi.waitFor(() => expect(location()).toBe(spatial.id))
    expect(result()).toBe('next:true')
    container.remove()
  })
})

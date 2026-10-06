import { mountV10Model } from '../../../src/player/componentPlatform/ModelPlayer'
import { prepareSandboxComponent } from '../../../src/renderer/components/SandboxComponentImplementation'
import { webContentRealmSource } from '../../../src/components/web/contentRealmImplementation'
import { WEB_DEFINITION, HTML_PROGRAM_DEFINITION } from '../../../src/components/web/data'
import { createBlankCourseProjectV10 } from '../../../src/core/course/createCourseProjectV10'
import type { CourseProjectV10, ComponentInstance } from '../../../src/shared/contracts/component-platform'

let serial = 0
const project = createBlankCourseProjectV10('Measured fragment canvas', () => `seed-${++serial}`)
project.instances = {}; project.global = { underlay: [], overlay: [] }; project.surfaces[0]!.childIds = []
project.theme = { css: 'body,html{background-color:rgb(2,6,23)!important;color:rgb(12,34,56);font-family:serif}@media(min-width:1px){body,[data-theme-paint]{background-image:linear-gradient(red,blue)}}' }
project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
project.definitions[HTML_PROGRAM_DEFINITION.id] = HTML_PROGRAM_DEFINITION
const add = (id: string, html: string, key = WEB_DEFINITION.id) => {
  const instance: ComponentInstance = { id, definitionId: key, data: { html }, frame: { width: 220, height: 70, transform: [1, 0, 0, 1, 20, 20 + project.surfaces[0]!.childIds.length * 90] } }
  project.instances[id] = instance; project.surfaces[0]!.childIds.push(id)
}
add('plain', '<div id="plain">透明片段<span data-theme-paint>主题内部绘制</span></div>')
add('local', '<style>body{background-color:rgb(10,20,30)}</style><div id="local">作者局部画布</div>')
add('document', '<!doctype html><html><head><title>完整文档</title></head><body><div id="document">完整文档画布</div></body></html>')
add('program', '<div id="program">HTMLProgram 画布</div>', HTML_PROGRAM_DEFINITION.id)
project.definitions.source = { id: 'source', title: 'Source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'fixture' }, dataSchema: {} }
add('source', '', 'source')
const errors: string[] = []
const player = mountV10Model({ root: document.querySelector('#root')!, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, runScopeId: 'theme-canvas-real', mode: 'capture',
  report: message => errors.push(message),
  resolveBuiltin: (key, signal) => prepareSandboxComponent({ format: 'esm', code: webContentRealmSource(), css: '', diagnostics: [] }, signal,
    { builtinKey: key, state: () => player.runtime.stateSnapshot(), targets: profile => player.runtime.targetSnapshots(profile), themeCss: () => player.runtime.themeCss(), resources: () => player.runtime.resourceUrls() }),
  resolveSource: (_implementation, signal) => prepareSandboxComponent({ format: 'esm', code: 'export default{mount({root}){root.innerHTML="<div id=source>Source画布</div>";return{update(){},dispose(){}}}}', css: '', diagnostics: [] }, signal,
    { state: () => player.runtime.stateSnapshot(), targets: profile => player.runtime.targetSnapshots(profile), themeCss: () => player.runtime.themeCss(), resources: () => player.runtime.resourceUrls() }) })
;(window as unknown as { changeTheme(): Promise<void> }).changeTheme = async () => {
  const next: CourseProjectV10 = structuredClone(project)
  next.theme = { css: 'body,html{background-color:rgb(40,50,60)!important;color:rgb(65,43,21);font-family:monospace}' }
  await player.update({ kind: 'course-v10', project: next, resources: { assets: {}, components: {} } })
}
player.ready.then(() => { Object.assign(window, { fixtureReady: true, fixtureErrors: errors }) }, error => { Object.assign(window, { fixtureStartupError: String(error?.stack ?? error) }) })

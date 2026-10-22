import { componentContainerBuiltinKey, createComponentContainerInstance, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { getBuiltinComponentSource } from '../components/source/builtinSources'

export function createBlankCourseProjectV10(title = '未命名课件', createId: () => string = () => crypto.randomUUID()): CourseProjectV10 {
  const projectId = createId(), rootId = createId(), definitionId = componentContainerBuiltinKey('slide')
  const project: CourseProjectV10 = {
    schemaVersion: 11, id: projectId, revision: 0, title,
    playback: { controls: 'none', keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } },
    definitions: { [definitionId]: { id: definitionId, role: 'mixed', title: '幻灯片容器', implementation: { kind: 'builtin', key: definitionId } } },
    instances: { [rootId]: createComponentContainerInstance({ id: rootId, kind: 'slide', title: '第 1 页', childIds: [], designSize: { width: 1280, height: 720 } }, definitionId) },
    rootIds: [rootId], entry: { rootInstanceId: rootId }, assets: {}, global: { underlay: [], overlay: [] },
  }
  return project
}

/** An explicit program work owns its source directly, without an implicit presentation container. */
export function createBlankProgramProject(title = '未命名程序', createId: () => string = () => crypto.randomUUID()): CourseProjectV10 {
  const id = createId(), rootId = createId(), definitionId = createId()
  const implementation = getBuiltinComponentSource('guoling.html-program')
  if (!implementation) throw new Error('程序组件源码尚未就绪')
  return { schemaVersion: 11, id, revision: 0, title, rootIds: [rootId], entry: { rootInstanceId: rootId },
    definitions: { [definitionId]: { id: definitionId, role: 'mixed', title: 'Web 程序', implementation, professionalBuiltinKey: 'guoling.html-program' } },
    instances: { [rootId]: { id: rootId, definitionId, name: title, data: { html: '', css: '' } } },
    assets: {}, global: { underlay: [], overlay: [] } }
}

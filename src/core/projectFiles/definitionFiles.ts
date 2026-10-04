import { courseComponentNameIssue, courseComponentNameKey } from '../../shared/composition/projectReferences'
import type { CourseComponentDefinition, CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/workbench/document'
import { deleteCourseComponent, findCourseComponentName, renameCourseComponent, setCourseComponent } from '../course/courseComponents'
import { componentPackageKey } from '../drivers/codecs/archivePath'
import { parseComponentPackageFiles } from '../drivers/codecs/importComponentPackage'
import { parseProgramHtml } from './pageHtml'
import { componentFile, controllerSource } from './projectFileView'
import { ProjectFileError, type PlannedChange } from './slidePages'
import { findGlobalTeacherController, makeGlobalLayerAuthoringAddress } from '../tools/globalLayers'
import { deleteEffectiveLayerItems } from '../tools/layerCommands'
import { createDefaultTeacherControllerPackage } from '../../shared/defaultTeacherControllerComponent'
import { createTeacherControllerComponentItem } from '../../shared/teacherControllerItem'
import { componentPackageMeta } from '../../shared/componentPackageMeta'
import { courseSlideCanvas } from '../../shared/slideCanvas'
import { synchronizeCourseTeacherControllerControls } from '../../shared/teacherControllerConsistency'
import { allocateCourseLayerOrder, sortScopedLayerList } from '../tools/layerOrder'
import { nanoid } from 'nanoid'

const COMPONENT_PATH = /^components\/([^/]+)\.html$/

export function componentPathName(path: string): string | undefined {
  return COMPONENT_PATH.exec(path)?.[1]
}

/** `theme.css` is the course theme; normalization binds its `url(../assets/…)` slots. */
export function planThemeWrite(project: CourseProjectDocument, resources: DocumentResources, css: string): PlannedChange {
  const next = structuredClone(project)
  if (css.trim()) next.theme = { ...next.theme, css }
  else delete next.theme
  return { project: next, resources, identity: 'theme', diagnostics: [] }
}

/**
 * `components/<name>.html` is the named definition every page copy follows. A write always asks for a running
 * definition; if admission refuses it, `draft` saves the same text disabled with the reason, as the format requires.
 */
export function planComponentWrite(project: CourseProjectDocument, resources: DocumentResources, path: string, html: string): PlannedChange {
  const name = componentPathName(path)
  const issue = name === undefined ? '组件路径须为 components/<名称>.html' : courseComponentNameIssue(name)
  if (issue || name === undefined) throw new ProjectFileError('invalid-path', issue ?? '组件路径无效')
  const stored = findCourseComponentName(project, name)
  const previous = stored === undefined ? undefined : project.components![stored]!
  const program = parseProgramHtml(html, project.assets, previous)
  const { draft: _draft, ...rest } = program as CourseComponentDefinition
  const definition: CourseComponentDefinition = { ...rest, enabled: true,
    content: program === previous ? previous.content : { values: {} } }
  const write = (value: CourseComponentDefinition) => setCourseComponent(project, stored ?? name, value)
  return { project: write(definition), resources, identity: `component:${courseComponentNameKey(name)}`, diagnostics: [],
    draft: reason => ({ project: write({ ...definition, enabled: false, draft: { reason: reason.slice(0, 2000) } }), resources,
      identity: `component:${courseComponentNameKey(name)}`, diagnostics: [] }) }
}

export function planComponentMove(project: CourseProjectDocument, resources: DocumentResources, from: string, to: string): PlannedChange {
  const source = componentFile(project, from), name = componentPathName(to)
  if (!source) throw new ProjectFileError('not-found', `没有这个组件：${from}`)
  if (name === undefined) throw new ProjectFileError('invalid-path', '组件路径须为 components/<名称>.html')
  try {
    return { project: renameCourseComponent(project, source.name, name), resources, identity: `component:${courseComponentNameKey(name)}`, diagnostics: [] }
  } catch (error) { throw new ProjectFileError('invalid-path', error instanceof Error ? error.message : String(error)) }
}

/** Pages that still use a deleted component show its placeholder until it is written again. */
export function planComponentDelete(project: CourseProjectDocument, resources: DocumentResources, path: string): PlannedChange {
  const source = componentFile(project, path)
  if (!source) throw new ProjectFileError('not-found', `没有这个组件：${path}`)
  return { project: deleteCourseComponent(project, source.name), resources, identity: `component:${courseComponentNameKey(source.name)}`, diagnostics: [] }
}

/**
 * `controller/教师控制台.js` is the entry source of the course's embedded controller package. A revision keeps
 * the package identity and version (as the editor's source revision does) and always goes through admission.
 */
export function planControllerWrite(project: CourseProjectDocument, resources: DocumentResources, source: string, createId: () => string = nanoid): PlannedChange {
  let current = controllerSource(project, resources)
  let created = false
  if (!current) {
    if (findGlobalTeacherController(project)) throw new ProjectFileError('missing-controller-source', '现有教师控制台源码不可读，请修复其组件包后重试')
    const pkg = createDefaultTeacherControllerPackage(), next = structuredClone(project)
    const meta = next.componentPackages[pkg.manifest.id] ?? componentPackageMeta(pkg)
    const key = componentPackageKey(meta.packageId, meta.version)
    if (next.componentPackages[pkg.manifest.id] && !resources.components[key])
      throw new ProjectFileError('missing-controller-source', '工程引用的教师控制台包缺少源码，原包与独立导航已保留')
    const item = createTeacherControllerComponentItem(`teacher_controller_${createId()}`, courseSlideCanvas(project))
    item.component = { packageId: meta.packageId, version: meta.version }
    item.order = allocateCourseLayerOrder(project, item.order)
    next.globalLayerItems.push({ item, visibility: { mode: 'all', locationIds: [] }, plane: 'overlay' })
    sortScopedLayerList(next.globalLayerItems)
    next.componentPackages[pkg.manifest.id] = meta
    synchronizeCourseTeacherControllerControls(next)
    resources = { ...resources, components: { ...resources.components, [key]: resources.components[key] ?? pkg.files } }
    project = next; current = controllerSource(project, resources); created = true
  }
  if (!current) throw new ProjectFileError('missing-controller-source', '教师控制台组件包缺少入口源码')
  const key = componentPackageKey(current.packageId, current.version)
  const files = { ...resources.components[key]!, [current.entry]: new TextEncoder().encode(source) }
  let contentSha256: string
  try { contentSha256 = parseComponentPackageFiles(files, { expectedId: current.packageId, expectedVersion: current.version }).contentSha256! }
  catch (error) { throw new ProjectFileError('invalid-component', `教师控制台源码无效：${error instanceof Error ? error.message : String(error)}`) }
  const next = structuredClone(project)
  next.componentPackages[current.packageId] = { ...next.componentPackages[current.packageId]!, contentSha256 }
  return { project: next, resources: { ...resources, components: { ...resources.components, [key]: files } }, identity: 'controller', diagnostics: [],
    admission: created || source !== current.source }
}

/** Remove the installed controller through the same structural delete as the editor; retain packages and other navigation. */
export function planControllerDelete(project: CourseProjectDocument, resources: DocumentResources): PlannedChange {
  const controller = findGlobalTeacherController(project)
  if (!controller) throw new ProjectFileError('not-found', '本课件没有教师控制台')
  const deleted = deleteEffectiveLayerItems(project, [{ locationId: project.startLocationId,
    authoringAddress: makeGlobalLayerAuthoringAddress(project.id, controller.item.layerItemId, 'component') }])
  if (!deleted.ok || !deleted.nextDocument) throw new ProjectFileError('delete-refused', deleted.reason ?? '无法删除教师控制台')
  return { project: deleted.nextDocument, resources, identity: 'controller', diagnostics: [] }
}

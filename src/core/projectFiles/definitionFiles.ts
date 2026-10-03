import { courseComponentNameIssue, courseComponentNameKey } from '../../shared/composition/projectReferences'
import type { CourseComponentDefinition, CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/workbench/document'
import { deleteCourseComponent, findCourseComponentName, renameCourseComponent, setCourseComponent } from '../course/courseComponents'
import { parseProgramHtml } from './pageHtml'
import { componentFile } from './projectFileView'
import { ProjectFileError, type PlannedChange } from './slidePages'

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

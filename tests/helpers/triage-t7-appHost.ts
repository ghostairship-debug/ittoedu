import { waitFor } from '@testing-library/react'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { DesktopAPI } from '../../src/shared/ipcTypes'
import { bootTriageCourseHost, formalCourse, projectCourse, settleCourse, type TriageCourseHost } from './triage-t7-courseHost'
import type { ComponentPackageData } from '../../src/shared/componentTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'

/** App-level desktop mock that also owns the real per-document DocumentSession host. */
export function withAppDocuments<T extends Partial<DesktopAPI>>(
  api: T,
  host: TriageCourseHost,
): T & Pick<DesktopAPI, 'documents'> {
  return { ...api, documents: host.api }
}

/** App connects `window.desktopAPI.documents` in an effect; wait for that bootstrap. */
export async function waitForAppDocuments(): Promise<void> {
  await waitFor(() => {
    if (!useEditorStore.getState().courseDocument.connected) throw new Error('课程文档服务尚未连接')
  })
}

/**
 * Render-time replacement for the removed `loadCourseProject` shortcut: the App has
 * connected its host, so open `project` through the real DocumentSession.
 */
export async function openAppCourse(
  host: TriageCourseHost,
  project: CourseProjectDocument,
  assetFiles: Record<string, Uint8Array> = {},
  componentPackages: Record<string, ComponentPackageData> = {},
): Promise<CourseProjectDocument> {
  await projectCourse(host, project, assetFiles, componentPackages)
  useEditorStore.getState().activateCourseLocation(project.startLocationId)
  return project
}

export { bootTriageCourseHost, formalCourse, settleCourse }
export type { TriageCourseHost }

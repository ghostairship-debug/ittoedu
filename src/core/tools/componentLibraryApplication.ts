import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../shared/workbench/document'
import { extractComponentLibraryEntry, prepareComponentLibraryInsertion, type ExtractLibraryOptions, type InsertLibraryOptions } from '../components/library'

/** The Gateway resolves authority and placement; this helper only prepares the canonical batch. */
export function prepareComponentLibraryApplication(project: CourseProjectV10, entry: ComponentLibraryEntry, target: InsertLibraryOptions) {
  return prepareComponentLibraryInsertion(project, entry, target)
}

/** Copy the captured author graph and its real resource bytes; never persist the live project. */
export function extractComponentLibraryApplication(project: CourseProjectV10, resources: DocumentResources, target: Omit<ExtractLibraryOptions, 'id'> & { id?: string }) {
  return extractComponentLibraryEntry(project, resources, { ...target, id: target.id ?? `library_${globalThis.crypto.randomUUID()}` })
}

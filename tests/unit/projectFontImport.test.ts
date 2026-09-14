import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ComponentPackageData } from '../../src/shared/componentTypes'
import { componentRegistryKey, componentRuntimeSourceIdentity } from '../../src/shared/componentRegistryIdentity'
import { parseComponentPackageFiles } from '../../src/renderer/components/importComponentPackage'
import { inspectProjectFont } from '../../src/shared/fonts/projectFontFile'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { planProjectFontImport } from '../../src/renderer/course/projectFontImport'
import { createEditorTransactionStep, applyEditorTransactionStep } from '../../src/renderer/authoring/editorTransaction'
import { createProjectFontDeliveryFixture } from '../fixtures/projectFontDelivery'
import {  collectPublishedCourseSourceIssues } from '../../src/renderer/export/course/buildPublishedCourse'

describe('project font import transaction', () => {
  const bytes = new Uint8Array(readFileSync(resolve('node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-latin-wght-normal.woff2')))
  it('imports an actual WOFF2, saves and reopens it, and undoes both metadata and bytes', async () => {
    expect(inspectProjectFont(bytes)).toEqual({ mimeType: 'font/woff2', extension: 'woff2' })
    const project = createBlankCourseProject()
    const imported = await planProjectFontImport(project, 'lesson.woff2', bytes)
    const step = createEditorTransactionStep(project, imported.transaction)
    if (!step) throw new Error('Expected font transaction')
    const applied = applyEditorTransactionStep({ document: project, resources: { assetFiles: {}, componentPackages: {} } }, step, 'forward')
    expect(applied.document.assets[imported.assetId]?.kind).toBe('font')
    expect(applied.document.surfaces).toEqual(project.surfaces)
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: applied.document, assetFiles: { ...applied.resources.assetFiles }, componentFiles: {} }))
    expect(inspectProjectFont(reopened.assetFiles[imported.assetId]!)).toEqual({ mimeType: 'font/woff2', extension: 'woff2' })
    expect(applyEditorTransactionStep(applied, step, 'inverse')).toEqual({ document: project, resources: { assetFiles: {}, componentPackages: {} } })
  })
  it('rejects media bytes and malformed font length before any transaction', async () => {
    const project = createBlankCourseProject()
    await expect(planProjectFontImport(project, 'pretend.woff2', new Uint8Array(32))).rejects.toThrow('仅支持')
    await expect(planProjectFontImport(project, 'truncated.woff2', bytes.slice(0, 80))).rejects.toThrow('文件长度')
    expect(project.assets).toEqual({})
  })
  it('closes direct Component and Runtime font references and locates missing bytes', async () => {
    const fallback = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg==', 'base64'))
    const sources = await createProjectFontDeliveryFixture(bytes, fallback)
    const payload = buildPublishedCourseV2Payload(sources)
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: sources.project, assetFiles: { ...sources.assetFiles },
      componentFiles: Object.fromEntries(Object.entries(sources.components).map(([id, data]) => [id, data.files])) }))
    expect(Object.keys(reopened.componentFiles)).toHaveLength(1)
    const reopenedComponent = parseComponentPackageFiles(Object.values(reopened.componentFiles)[0]!)
    const registryKey = (projectId: string, data: ComponentPackageData) => componentRegistryKey({ projectId, packageId: data.manifest.id,
      version: data.manifest.version, sourceIdentity: componentRuntimeSourceIdentity(data.runtimeSource), contentIdentity: data.contentSha256! })
    expect(registryKey(reopened.project.id, reopenedComponent)).toBe(registryKey(sources.project.id, sources.components['font-demo']!))
    const fontId = Object.keys(sources.project.assets).find(id => id.startsWith('font-'))!
    expect(payload.assets[fontId]?.url).toMatch(/^data:font\/woff2;base64,/)
    expect(payload.assets['unused-font']).toBeUndefined()
    const missing = { ...sources, assetFiles: { 'fallback-image': fallback } }
    const issues = collectPublishedCourseSourceIssues(missing).filter(issue => issue.code === 'asset-bytes-missing')
    expect(issues.some(issue => issue.path.includes('runtimeSource'))).toBe(true)
    expect(issues.some(issue => issue.path.includes('source'))).toBe(true)
    expect(() => buildPublishedCourseV2Payload(missing)).toThrow()
  })
})

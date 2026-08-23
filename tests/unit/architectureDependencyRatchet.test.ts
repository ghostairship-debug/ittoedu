import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function filesUnder(directory: string): string[] {
  const absolute = join(root, directory)
  const result: string[] = []
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name)
      if (entry.isDirectory()) visit(next)
      else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
        result.push(relative(root, next).replace(/\\/g, '/'))
      }
    }
  }
  visit(absolute)
  return result.sort()
}

function importSpecifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!)
}

function expectBefore(text: string, first: string, second: string): void {
  const firstIndex = text.indexOf(first)
  const secondIndex = text.indexOf(second)
  expect(firstIndex, first).toBeGreaterThanOrEqual(0)
  expect(secondIndex, second).toBeGreaterThanOrEqual(0)
  expect(firstIndex, `${first} before ${second}`).toBeLessThan(secondIndex)
}

describe('ARCH-1 dependency ratchet', () => {
  it('keeps Core identity and transaction seams independent of concrete Surfaces and Features', () => {
    for (const path of [
      'src/renderer/authoring/courseAuthoringSession.ts',
      'src/renderer/authoring/editorTransaction.ts',
    ]) {
      const imports = importSpecifiers(source(path))
      expect(imports.filter((specifier) => (
        /(?:^|\/)course\//.test(specifier) ||
        /(?:^|\/)components\//.test(specifier) ||
        /(?:^|\/)ui\//.test(specifier)
      )), path).toEqual([])
      expect(source(path), path).not.toMatch(/\buseEditorStore\b|\bApp\.tsx\b/)
    }
  })

  it('keeps the Slide history seam free of App, UI, Media and raw Store dependencies', () => {
    const path = 'src/renderer/course/slideEditorCommands.ts'
    const text = source(path)
    expect(importSpecifiers(text).filter((specifier) => (
      /(?:^|\/)ui\//.test(specifier) ||
      /v9MediaAudioCommands/.test(specifier) ||
      /(?:^|\/)components\//.test(specifier)
    ))).toEqual([])
    expect(text).not.toMatch(/\buseEditorStore\b|\bApp\.tsx\b/)
    expect(text).toContain('commitSlideEditorTransactionHistory')
  })

  it('keeps Player independent from renderer Store modules', () => {
    const violations = filesUnder('src/player').flatMap((path) => (
      importSpecifiers(source(path))
        .filter((specifier) => /renderer\/store|renderer\\store/.test(specifier))
        .map((specifier) => `${path} -> ${specifier}`)
    ))
    expect(violations).toEqual([])
  })

  it('locks the image use-case onto the target planner and one transaction path', () => {
    const app = source('src/renderer/App.tsx')
    const store = source('src/renderer/store/editorStore.ts')
    expect(app).toContain('captureImageReplacementTarget()')
    expect(app).toContain('replaceImageAssetAtTarget(')
    expect(app).not.toMatch(/\breplaceImageAsset\(/)

    const start = store.indexOf('    replaceImageAssetAtTarget(target, asset, bytes) {')
    const end = store.indexOf('\n    importSound(', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const useCase = store.slice(start, end)
    expect(useCase).toContain('planCourseImageReplacement({')
    expect(useCase).toContain('createEditorTransactionStep(document, planned.plan)')
    expect(useCase).toContain('commitSlideEditorTransactionHistory(session.history, step)')
    expect(useCase).toContain('persistCandidateResult({')
    expect(useCase).not.toMatch(/runV9DocumentMutation|commitAssetTransaction/)
  })
})

describe('ARCH-2 resource-safety ratchet', () => {
  it('keeps pure resource planners and shared history free of App, UI and the Editor Store', () => {
    for (const path of [
      'src/renderer/media/courseMediaLibraryImport.ts',
      'src/renderer/components/courseComponentPackageTransactions.ts',
      'src/renderer/authoring/resourceAwareAuthoringHistory.ts',
    ]) {
      const text = source(path)
      expect(text, path).not.toMatch(/\buseEditorStore\b|\bApp\.tsx\b/)
      expect(importSpecifiers(text).filter((specifier) => (
        /(?:^|\/)ui\//.test(specifier) || /editorStore/.test(specifier)
      )), path).toEqual([])
    }
  })

  it('keeps Flow and Spatial on the resource-aware frame seam beside the Slide donor', () => {
    const flow = source('src/renderer/course/flowEditorSlice.ts')
    const spatial = source('src/renderer/course/spatialAuthoringHistory.ts')
    expect(flow).toContain('commitFlowEditorTransactionHistory')
    expect(flow).toContain('flowEditorUndoResourceTransition')
    expect(flow).toContain('flowEditorRedoResourceTransition')
    expect(flow).toContain('flowEditorLegacyHistoryEntryCount')
    expect(flow).toContain('ResourceAwareAuthoringHistoryEntry')
    expect(spatial).toContain('commitSpatialEditorTransactionHistory')
    expect(spatial).toContain('spatialAuthoringUndoResourceTransition')
    expect(spatial).toContain('spatialAuthoringRedoResourceTransition')
    expect(spatial).toContain('spatialAuthoringLegacyHistoryEntryCount')
    expect(spatial).toContain('ResourceAwareAuthoringHistoryEntry')
  })

  it('locks Media and Components onto target-based project resource transactions', () => {
    const store = source('src/renderer/store/editorStore.ts')
    expect(store).toContain('planCourseMediaLibraryImport({')
    expect(store).toContain('planCourseComponentPackageReplacement({')
    expect(store).toContain('persistProjectResourceTransaction(')
    expect(store).not.toContain('planComponentPackageReplacement(')
    expect(store).not.toContain('retargetCourseComponentInstances')
    expect(store).not.toContain('for (const item of items) get().importAsset')
    expect(store).not.toContain('importCourseMediaAssets')
    for (const compatibilityField of [
      'slideCandidateSidecarPast',
      'slideCandidateSidecarFuture',
      'slideCandidateComponentPackagesPast',
      'slideCandidateComponentPackagesFuture',
    ]) {
      expect(store).toContain(compatibilityField)
    }

    const importStart = store.indexOf('    importAssets(items) {')
    const importEnd = store.indexOf('\n    captureImageReplacementTarget()', importStart)
    expect(importStart).toBeGreaterThanOrEqual(0)
    expect(importEnd).toBeGreaterThan(importStart)
    expect(store.slice(importStart, importEnd)).not.toContain('importCourseMediaAssets')

    const replaceStart = store.indexOf('    replaceComponentPackage(packageId, packageData) {')
    const replaceEnd = store.indexOf('\n    createEditableComponentCopy(', replaceStart)
    expect(replaceStart).toBeGreaterThanOrEqual(0)
    expect(replaceEnd).toBeGreaterThan(replaceStart)
    const replacement = store.slice(replaceStart, replaceEnd)
    expect(replacement).toContain('commitComponentReplacementAtTarget(')
    expect(replacement).not.toMatch(/runV9DocumentMutation|\bcommit\(/)
  })

  it('captures async App targets before Media and Components package reads', () => {
    const app = source('src/renderer/App.tsx')
    const image = app.slice(
      app.indexOf('const selectAndImportImage'),
      app.indexOf('const selectImageAsset'),
    )
    expectBefore(image, 'captureMediaLibraryImportTarget()', 'selectImages()')

    const video = app.slice(
      app.indexOf('const selectAndImportVideo'),
      app.indexOf('const handleImportComponent'),
    )
    expectBefore(video, 'captureMediaLibraryImportTarget()', 'selectVideos()')

    const manual = app.slice(
      app.indexOf('const handleReplaceComponent'),
      app.indexOf('const performComponentReplacement'),
    )
    expectBefore(
      manual,
      'captureComponentPackageReplacementTarget(packageId)',
      'selectComponentPackage()',
    )

    const catalog = app.slice(
      app.indexOf('const performCatalogPackageOperation'),
      app.indexOf('const requestCatalogPackageBatch'),
    )
    expectBefore(
      catalog,
      'captureComponentPackageReplacementTarget',
      'readComponentCatalogPackage',
    )
  })
})

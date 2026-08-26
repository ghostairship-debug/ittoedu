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

function countLiteral(text: string, literal: string): number {
  return text.split(literal).length - 1
}

function sliceBetween(text: string, first: string, second: string): string {
  const start = text.indexOf(first)
  const end = text.indexOf(second, start + first.length)
  expect(start, first).toBeGreaterThanOrEqual(0)
  expect(end, second).toBeGreaterThan(start)
  return text.slice(start, end)
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

describe('ARCH-2 Runtime and Interaction ratchet', () => {
  it('keeps Runtime authoring on canonical target planners with retired raw writers at zero', () => {
    const runtimeFiles = filesUnder('src/renderer/runtime')
    const runtimeCorpus = runtimeFiles.map(source).join('\n')
    const sourceCorpus = filesUnder('src').map(source).join('\n')
    const store = source('src/renderer/store/editorStore.ts')

    const pureRuntimeFiles = new Set([
      ...runtimeFiles.filter((candidate) => (
        /(?:AuthoringCommands|AuthoringView)\.ts$/.test(candidate)
      )),
      'src/renderer/runtime/courseRuntimeTransactions.ts',
    ])
    for (const path of pureRuntimeFiles) {
      const text = source(path)
      expect(text, path).not.toMatch(/\buseEditorStore\b|\bApp\.tsx\b/)
      expect(importSpecifiers(text).filter((specifier) => (
        /(?:^|\/)ui\//.test(specifier) || /editorStore/.test(specifier)
      )), path).toEqual([])
    }

    const runtimeWord = 'Runtime'
    for (const retired of [
      ['set', 'Scene', runtimeWord].join(''),
      ['set', 'Global', runtimeWord].join(''),
      ['update', 'Scene', runtimeWord].join(''),
      ['update', 'Global', runtimeWord].join(''),
      ['runtime', 'Document', 'To', 'Course', runtimeWord].join(''),
      ['make', runtimeWord, 'Layer', 'Item'].join(''),
      ['write', 'Scene', runtimeWord].join(''),
      ['write', 'Global', runtimeWord].join(''),
      ['fresh', runtimeWord].join(''),
    ]) {
      expect(sourceCorpus, retired).not.toMatch(new RegExp(`\\b${retired}\\b`))
    }
    const readProjection = ['course', runtimeWord, 'To', 'Document'].join('')
    expect(countLiteral(sourceCorpus, readProjection)).toBe(3)

    for (const [start, end, planner] of [
      ['  const commitRuntimeSourceAtTarget = (', '  const commitRuntimeContentTextAtTarget = (', 'planRuntimeSourceUpdate({'],
      ['  const commitRuntimeContentTextAtTarget = (', '  const commitRuntimePropertyAtTarget = (', 'planRuntimeContentTextUpdate({'],
      ['  const commitRuntimePropertyAtTarget = (', '  const rejectRuntimeTemplateCreation = (', 'planRuntimePropertyUpdate({'],
      ['  const commitRuntimeTemplateCreationAtTarget = (', '  const rejectInteractionAuthoring = (', 'planRuntimeTemplateCreation({'],
      ['  const commitRuntimeAssetReplacementAtTarget = (', '  const persistFlowLayerCommand = (', 'planCourseRuntimeAssetReplacement({'],
    ] as const) {
      const useCase = sliceBetween(store, start, end)
      expect(useCase, planner).toContain(planner)
      expect(useCase, start).toContain('createEditorTransactionStep(')
      expect(useCase, start).toContain('persistProjectResourceTransaction(')
    }
    expect(runtimeCorpus).not.toMatch(/\bRuntimeDocument\b/)

    const templateUiConsumers = filesUnder('src/renderer/ui').filter((path) => (
      source(path).includes('createRuntimeTemplateAtTarget')
    ))
    expect(templateUiConsumers).toEqual(['src/renderer/ui/DeveloperTab.tsx'])
  })

  it('keeps Automation template and supported professional fields on the V9 planner path', () => {
    for (const path of [
      'src/renderer/interactions/interactionAuthoringCommands.ts',
      'src/renderer/interactions/interactionAuthoringView.ts',
      'src/renderer/interactions/interactionTemplates.ts',
    ]) {
      const text = source(path)
      expect(text, path).not.toMatch(/\buseEditorStore\b|\bApp\.tsx\b/)
      expect(importSpecifiers(text).filter((specifier) => (
        /(?:^|\/)ui\//.test(specifier) || /editorStore/.test(specifier)
      )), path).toEqual([])
    }

    const store = source('src/renderer/store/editorStore.ts')
    const applyTemplate = sliceBetween(
      store,
      '    applyInteractionTemplateAtTarget(target, template) {',
      '    updateInteractionRuleAtTarget(target, ruleId, patch) {',
    )
    expect(applyTemplate).toContain('planApplyInteractionTemplate({')
    expect(applyTemplate).toContain('persistInteractionAuthoringPlan(')
    const updateRule = sliceBetween(
      store,
      '    updateInteractionRuleAtTarget(target, ruleId, patch) {',
      '    addInteractionRule(sceneId, rule) {',
    )
    expect(updateRule).toContain('planUpdateInteractionRule({')
    expect(updateRule).toContain('persistInteractionAuthoringPlan(')

    const automation = source('src/renderer/ui/AutomationTab.tsx')
    expect(automation).toContain('applyInteractionTemplateAtTarget(authoringTarget, {')
    expect(automation).toContain('updateInteractionRuleAtTarget(authoringTarget, ruleId, patch)')
    expect(automation).toContain("interactionView.carrier === 'global'")
    expect(automation).toContain("interactionView.activeSurfaceType !== 'slide'")

    const rawUiConsumers = filesUnder('src/renderer/ui').filter((path) => (
      /\bupdate(?:Global)?InteractionRule\b/.test(source(path))
    ))
    expect(rawUiConsumers).toEqual([
      'src/renderer/ui/DeveloperTab.tsx',
      'src/renderer/ui/PropertiesTab.tsx',
    ])
  })

  it('keeps session-owned global and optional Slide-local controllers on all three Surface ports', () => {
    const session = source('src/player/surfaces/publishedDynamicHosts.ts')
    expect(countLiteral(session, 'new PublishedInteractionController({')).toBe(2)
    expect(session).toContain('#globalInteractionController')
    expect(session).toContain('#localInteractionController')
    expect(session).toContain('createPublishedCourseSession(')
    expect(session).toContain('getPublishedInteractionSurfacePort()')

    for (const path of [
      'src/player/surfaces/slide/SlidePublishedAdapter.ts',
      'src/player/surfaces/flow/FlowSurfaceHost.ts',
      'src/player/surfaces/spatial/SpatialSurfaceHost.ts',
    ]) {
      const host = source(path)
      expect(host, path).toContain('PublishedDomInteractionSurfacePort')
      expect(host, path).toContain('getPublishedInteractionSurfacePort()')
      expect(host, path).toContain('refreshNodes(')
    }

    const legacyEngineConsumers = filesUnder('src/player').filter((path) => (
      source(path).includes('new InteractionEngine(')
    ))
    expect(legacyEngineConsumers).toEqual(['src/player/PlayerScene.ts'])
  })

  it('keeps global playback actions on canonical V9 Surface histories', () => {
    const store = source('src/renderer/store/editorStore.ts')
    const updatePlayback = sliceBetween(
      store,
      '    updatePlayback(patch) {',
      '    updateDesignTokens(tokens) {',
    )
    expect(updatePlayback).toContain('updateCoursePlaybackSettings(')
    expect(updatePlayback).toContain('persistSpatialLayerCommand(')
    expect(updatePlayback).toContain('persistFlowLayerCommand(')
    expect(updatePlayback).toContain('persistLayerCommand(')
    expect(updatePlayback).not.toMatch(/\bcommit\(/)

    const ensureTeacherController = sliceBetween(
      store,
      '    ensureTeacherController() {',
      '    addExternalComponentNode(packageId, x, y, presetId) {',
    )
    expect(ensureTeacherController).toContain('restoreDefaultTeacherController(')
    expect(ensureTeacherController).toContain('persistSpatialLayerCommand(')
    expect(ensureTeacherController).toContain('persistFlowLayerCommand(')
    expect(ensureTeacherController).toContain('persistLayerCommand(')
    expect(ensureTeacherController).not.toMatch(/\bcommit\(/)
  })
})

import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

const STORE_COMPOSITION_ADAPTERS = [
  'src/renderer/App.tsx',
  'src/renderer/composition/crossSurfaceCommands.ts',
  'src/renderer/composition/properties/PropertiesAuthoringReadModel.ts',
  'src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx',
  'src/renderer/dev/v9CandidateSmokeInject.ts',
  'src/renderer/diagnostics/projectHealthNavigation.ts',
  'src/renderer/main.tsx',
  'src/renderer/ui/AutomationTab.tsx',
  'src/renderer/ui/ComponentsTab.tsx',
  'src/renderer/ui/DeveloperTab.tsx',
  'src/renderer/ui/ElementsTab.tsx',
  'src/renderer/ui/MediaTab.tsx',
  'src/renderer/ui/NodesTab.tsx',
  'src/renderer/ui/ProjectHealthPanel.tsx',
  'src/renderer/ui/RightSidebar.tsx',
  'src/renderer/ui/ScenePanel.tsx',
  'src/renderer/ui/SceneStateStrip.tsx',
  'src/renderer/ui/SceneThumbnail.tsx',
  'src/renderer/ui/SimpleEntranceAnimationEditor.tsx',
  'src/renderer/ui/TopToolbar.tsx',
  'src/renderer/ui/Workspace.tsx',
] as const

function compositionRootFactory(text: string): string {
  return sliceBetween(
    text,
    'export const useEditorStore = create<EditorState>((set, get) => {',
    '\nlet cachedSlideUiPresent',
  )
}

function runtimeImportSpecifiers(text: string): string[] {
  return [...text.matchAll(
    /(?:^|\n)(?:import|export)\s+(?!type\b)[\s\S]*?from\s+['"]([^'"]+)['"]/g,
  )].map((match) => match[1]!)
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const absolute = resolve(join(root, fromFile, '..'), specifier)
  for (const candidate of [
    `${absolute}.ts`,
    `${absolute}.tsx`,
    join(absolute, 'index.ts'),
    join(absolute, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return relative(root, candidate).replace(/\\/g, '/')
  }
  return null
}

function editorStoreConsumers(): string[] {
  return filesUnder('src').filter((path) => {
    if (path === 'src/renderer/store/editorStore.ts') return false
    const text = source(path)
    return /from\s+['"][^'"]*editorStore['"]/.test(text) || /\buseEditorStore\b/.test(text)
  })
}

function runtimeCyclesAmong(entryFiles: readonly string[]): string[] {
  const nodes = new Set(entryFiles)
  const edges = new Map<string, string[]>()
  for (const file of entryFiles) {
    edges.set(file, runtimeImportSpecifiers(source(file)).flatMap((specifier) => {
      const resolved = resolveLocalImport(file, specifier)
      return resolved && nodes.has(resolved) ? [resolved] : []
    }))
  }
  const cycles: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const visit = (node: string): void => {
    if (visiting.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node].join(' -> '))
      return
    }
    if (visited.has(node)) return
    visiting.add(node)
    stack.push(node)
    for (const next of edges.get(node) ?? []) visit(next)
    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }
  for (const file of entryFiles) visit(file)
  return cycles
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
    const media = source('src/renderer/media/commitCourseMediaAuthoring.ts')
    expect(app).toContain('captureImageReplacementTarget()')
    expect(app).toContain('replaceImageAssetAtTarget(')
    expect(app).not.toMatch(/\breplaceImageAsset\(/)
    expect(store).toContain('...mediaAuthoringActions')
    expect(store).not.toMatch(/planCourseImageReplacement\(/)

    const start = media.indexOf('export function commitCourseImageReplacement(')
    const end = media.indexOf('\nexport function createMediaAuthoringActions(', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const useCase = media.slice(start, end)
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
    const media = source('src/renderer/media/commitCourseMediaAuthoring.ts')
    const components = source('src/renderer/components/commitComponentPackageAuthoring.ts')
    expect(media).toContain('planCourseMediaLibraryImport({')
    expect(components).toContain('planCourseComponentPackageReplacement({')
    expect(store).toMatch(/persistProjectResourceTransaction\s*=\s*\(/)
    expect(media).toContain('    importAssets(items: ImportedAssetBatchItem[]) {')
    expect(store).not.toContain('planCourseMediaLibraryImport({')
    expect(store).not.toContain('planCourseComponentPackageReplacement({')
    expect(store).not.toContain('planComponentPackageReplacement(')
    expect(store).not.toContain('retargetCourseComponentInstances')
    expect(store).not.toContain('for (const item of items) get().importAsset')
    expect(store).not.toContain('importCourseMediaAssets')
    for (const compatibilityField of [
      'courseAssetSidecarPast',
      'courseAssetSidecarFuture',
      'courseComponentPackagesPast',
      'courseComponentPackagesFuture',
    ]) {
      expect(store).toContain(compatibilityField)
    }

    const importStart = media.indexOf('    importAssets(items: ImportedAssetBatchItem[]) {')
    const importEnd = media.indexOf('\n    importSounds(', importStart)
    expect(importStart).toBeGreaterThanOrEqual(0)
    expect(importEnd).toBeGreaterThan(importStart)
    expect(media.slice(importStart, importEnd)).not.toContain('importCourseMediaAssets')

    const replaceStart = components.indexOf('    replaceComponentPackage(packageId: string, packageData: ComponentPackageData) {')
    const replaceEnd = components.indexOf('\n  }\n}', replaceStart)
    expect(replaceStart).toBeGreaterThanOrEqual(0)
    expect(replaceEnd).toBeGreaterThan(replaceStart)
    const replacement = components.slice(replaceStart, replaceEnd)
    expect(replacement).toContain('commitComponentReplacementAtTarget(')
    expect(replacement).not.toMatch(/runV9DocumentMutation|\bcommit\(/)
  })

  it('captures async App targets before Media and Components package reads', () => {
    const media = source('src/renderer/app/useMediaImport.ts')
    const image = media.slice(
      media.indexOf('const selectAndImportImage'),
      media.indexOf('const selectImageAsset'),
    )
    expectBefore(image, 'captureLibraryTarget()', 'selectImages()')

    const video = media.slice(
      media.indexOf('const selectAndImportVideo'),
      media.indexOf('const clearBatchSummary'),
    )
    expectBefore(video, 'captureLibraryTarget()', 'selectVideos()')

    const components = source('src/renderer/app/useComponentLibrary.ts')
    const manual = components.slice(
      components.indexOf('const replacePackage'),
      components.indexOf('const confirmReplacement'),
    )
    expectBefore(
      manual,
      'captureReplacementTarget(packageId)',
      'selectComponentPackage()',
    )

    const catalog = components.slice(
      components.indexOf('const performCatalogPackageOperation'),
      components.indexOf('const addCatalogPackages'),
    )
    expectBefore(
      catalog,
      'captureReplacementTarget(updateEntry.packageId)',
      'readCatalogPackage({',
    )
  })
})

describe('ARCH-2 Runtime and Interaction ratchet', () => {
  it('keeps Runtime authoring on canonical target planners with retired raw writers at zero', () => {
    const runtimeFiles = filesUnder('src/renderer/runtime')
    const runtimeCorpus = runtimeFiles.map(source).join('\n')
    const sourceCorpus = filesUnder('src').map(source).join('\n')
    const runtimeCommit = source('src/renderer/runtime/commitRuntimeAuthoring.ts')
    const store = source('src/renderer/store/editorStore.ts')
    expect(store).toContain('...runtimeAuthoringActions')
    expect(store).not.toMatch(/planRuntimeSourceUpdate\(/)
    expect(store).not.toMatch(/planRuntimeContentTextUpdate\(/)
    expect(store).not.toMatch(/planRuntimePropertyUpdate\(/)
    expect(store).not.toMatch(/planRuntimeTemplateCreation\(/)
    expect(store).not.toMatch(/planCourseRuntimeAssetReplacement\(/)

    for (const [start, end, planner] of [
      ['  const commitRuntimeSourceAtTarget = (', '  const captureRuntimeContentTextTarget = (', 'planRuntimeSourceUpdate({'],
      ['  const updateRuntimeContentTextAtTarget = (', '  const rejectRuntimePropertyAuthoring = (', 'planRuntimeContentTextUpdate({'],
      ['  const updateRuntimePropertyAtTarget = (', '  const rejectRuntimeTemplateCreation = (', 'planRuntimePropertyUpdate({'],
      ['  const createRuntimeTemplateAtTarget = (', '  const captureRuntimeAssetReplacementTarget = (', 'planRuntimeTemplateCreation({'],
      ['  const replaceRuntimeAssetAtTarget = (', '    updateRuntimeSourceAtTarget: commitRuntimeSourceAtTarget', 'planCourseRuntimeAssetReplacement({'],
    ] as const) {
      const useCase = sliceBetween(runtimeCommit, start, end)
      expect(useCase, planner).toContain(planner)
      expect(useCase, start).toContain('createEditorTransactionStep(')
      expect(useCase, start).toContain('persistTransaction(')
    }

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

    const interactions = source('src/renderer/interactions/commitInteractionAuthoring.ts')
    const applyTemplate = sliceBetween(
      interactions,
      '    applyInteractionTemplateAtTarget(',
      '    updateInteractionRuleAtTarget(',
    )
    expect(applyTemplate).toContain('planApplyInteractionTemplate({')
    expect(applyTemplate).toContain('persistInteractionAuthoringPlan(')
    const updateRule = sliceBetween(
      interactions,
      '    updateInteractionRuleAtTarget(',
      '  }\n}',
    )
    expect(updateRule).toContain('planUpdateInteractionRule({')
    expect(updateRule).toContain('persistInteractionAuthoringPlan(')
    const store = source('src/renderer/store/editorStore.ts')
    expect(store).toContain('...interactionAuthoringActions')
    expect(store).not.toMatch(/planApplyInteractionTemplate\(/)
    expect(store).not.toMatch(/planUpdateInteractionRule\(/)

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
    const runtime = source('src/renderer/runtime/commitRuntimeAuthoring.ts')
    const updatePlayback = sliceBetween(
      runtime,
      '    updatePlayback(patch: Parameters<typeof updateCoursePlaybackSettings>[1]) {',
      '    updateDesignTokens(tokens: ProjectDesignTokens) {',
    )
    expect(updatePlayback).toContain('updateCoursePlaybackSettings(')
    expect(updatePlayback).toContain('persistProject(')
    expect(updatePlayback).not.toMatch(/\bcommit\(/)

    const slide = source('src/renderer/store/slices/slideAuthoringSlice.ts')
    const flow = source('src/renderer/store/slices/flowAuthoringSlice.ts')
    const spatial = source('src/renderer/store/slices/spatialAuthoringSlice.ts')
    expect(slide).toContain('restoreDefaultTeacherController(')
    expect(flow).toContain('restoreDefaultTeacherController(')
    expect(spatial).toContain('restoreDefaultTeacherController(')
  })

  it('owns Surface persist writers in slices and clears V8 project/sidecar names', () => {
    const store = source('src/renderer/store/editorStore.ts')
    const srcCorpus = filesUnder('src').map(source).join('\n')
    expect(srcCorpus).not.toMatch(/slideCandidateSidecar/)
    expect(srcCorpus).not.toMatch(/derivedV8ProjectFrom/)
    expect(srcCorpus).not.toMatch(/projectCandidatePreviewDocument/)
    expect(store).not.toMatch(/\bproduce\(/)
    expect(store).not.toMatch(/\bcreateCourseProjectArchive\b/)
    expect(store).not.toMatch(/\bopenCourseProjectArchive\b/)
    expect(store).not.toMatch(/planMedia[A-Z]/)
    expect(source('src/renderer/store/slices/slideAuthoringSlice.ts')).toContain('persistSlideCandidateResult')
    expect(source('src/renderer/store/slices/flowAuthoringSlice.ts')).toContain('export function persistFlowResult')
    expect(source('src/renderer/store/slices/spatialAuthoringSlice.ts')).toContain('export function persistSpatialResult')
    expect(source('src/renderer/store/courseResourceState.ts')).toContain('commitCourseResourceState')
    expect(source('src/renderer/composition/surfaceRouter.ts')).toContain('planActivateCourseLocation')
    expect(source('src/renderer/authoring/v9TeacherControllerAuthoring.ts')).not.toMatch(/\buseEditorStore\b/)
    expect(source('src/renderer/authoring/v9TeacherControllerAuthoring.ts')).toContain('TeacherControllerAuthoringPorts')
  })
})

describe('r11-055 architecture modularity gate', () => {
  it('keeps editorStore.ts as a Zustand composition root without planner or document mutation', () => {
    const store = source('src/renderer/store/editorStore.ts')
    const factory = compositionRootFactory(store)
    expect(factory).toContain('...slideAuthoringSlice')
    expect(factory).toContain('...flowAuthoringSlice')
    expect(factory).toContain('...spatialAuthoringSlice')
    expect(factory).toContain('...courseLifecycleSlice')
    expect(factory).toContain('...editorShellSlice')
    expect(factory).toContain('...runtimeAuthoringActions')
    expect(factory).toContain('...mediaAuthoringActions')
    expect(factory).toContain('...componentAuthoringActions')
    expect(factory).toContain('...interactionAuthoringActions')
    expect(factory).toContain('...crossSurfaceCommands')
    expect(factory).toContain('createRuntimeAuthoringActions(')
    expect(factory).toContain('createMediaAuthoringActions(')
    expect(factory).toContain('createComponentAuthoringActions(')
    expect(factory).toContain('createInteractionAuthoringActions(')
    expect(factory).toContain('createCrossSurfaceCommands(')
    expect(factory).toContain('createEditorStoreKernel(')
    expect(factory).not.toMatch(/\bplan[A-Z]\w+\(/)
    expect(factory).not.toMatch(/\bproduce\(/)
    expect(factory).not.toMatch(
      /\b(?:addSlide(?:Text|Image|Video|Shape|Formula|Component)Layer|executeFlowEditorCommand|commitSlideProjectMutation|runV9DocumentMutation)\(/,
    )
    expect(store).not.toMatch(/export \* from/)
    expectBefore(
      store,
      'export const useEditorStore = create<EditorState>((set, get) => {',
      'export const selectActiveScene',
    )
    expect(store).toContain("'无限画布'")
    expect(store).toContain("'流式讲义'")
  })

  it('keeps slices and Feature use cases free of root Store, EditorState, and raw zustand', () => {
    const sliceFiles = filesUnder('src/renderer/store/slices')
    const useCaseFiles = [
      'src/renderer/runtime/commitRuntimeAuthoring.ts',
      'src/renderer/media/commitCourseMediaAuthoring.ts',
      'src/renderer/components/commitComponentPackageAuthoring.ts',
      'src/renderer/interactions/commitInteractionAuthoring.ts',
      'src/renderer/authoring/v9TeacherControllerAuthoring.ts',
      'src/renderer/composition/surfaceRouter.ts',
      'src/renderer/store/editorStoreKernel.ts',
      'src/renderer/store/courseResourceState.ts',
    ]
    for (const path of [...sliceFiles, ...useCaseFiles]) {
      const text = source(path)
      expect(text, path).not.toMatch(/\buseEditorStore\b/)
      expect(text, path).not.toMatch(/\bEditorState\b/)
      expect(importSpecifiers(text).filter((specifier) => /editorStore(?:\.ts)?$/.test(specifier)), path).toEqual([])
      expect(text, path).not.toMatch(/from ['"]zustand['"]/)
    }
    expect(source('src/renderer/composition/crossSurfaceCommands.ts')).not.toMatch(/\buseEditorStore\b/)
    expect(source('src/renderer/composition/crossSurfaceCommands.ts')).not.toMatch(/\bEditorState\b/)
    expect(runtimeImportSpecifiers(source('src/renderer/composition/crossSurfaceCommands.ts')).filter(
      (specifier) => /editorStore(?:\.ts)?$/.test(specifier),
    )).toEqual([])
    expect(source('src/renderer/store/slices/slideAuthoringSlice.ts')).toContain('kernel: EditorStoreKernel')
    expect(source('src/renderer/store/slices/flowAuthoringSlice.ts')).toContain('kernel: EditorStoreKernel')
    expect(source('src/renderer/store/slices/spatialAuthoringSlice.ts')).toContain('kernel: EditorStoreKernel')
    expect(source('src/renderer/store/slices/courseLifecycleSlice.ts')).toContain('_kernel: EditorStoreKernel')
    expect(source('src/renderer/store/slices/editorShellSlice.ts')).toContain('kernel: EditorStoreKernel')
  })

  it('keeps App hooks, Core kernel, and contracts free of Store and reverse Feature edges', () => {
    for (const path of [
      'src/renderer/app/useCourseProjectLifecycle.ts',
      'src/renderer/app/useCourseDelivery.ts',
      'src/renderer/app/useMediaImport.ts',
      'src/renderer/app/useComponentLibrary.ts',
      'src/renderer/app/useEditorKeyboardRouter.ts',
    ]) {
      const text = source(path)
      expect(text, path).not.toMatch(/\buseEditorStore\b/)
      expect(importSpecifiers(text).filter((specifier) => /editorStore/.test(specifier)), path).toEqual([])
    }
    const app = source('src/renderer/App.tsx')
    expect(app).toContain('useCourseProjectLifecycle')
    expect(app).toContain('useCourseDelivery')
    expect(app).toContain('useMediaImport')
    expect(app).toContain('useComponentLibrary')
    expect(app).toContain('useEditorKeyboardRouter')

    for (const path of [
      'src/renderer/store/editorStoreKernel.ts',
      'src/renderer/store/courseResourceState.ts',
      'src/renderer/authoring/courseAuthoringSession.ts',
      'src/renderer/authoring/editorTransaction.ts',
      'src/renderer/composition/surfaceRouter.ts',
    ]) {
      const imports = importSpecifiers(source(path))
      expect(imports.filter((specifier) => (
        /(?:^|\/)ui\//.test(specifier) ||
        /(?:^|\/)components\//.test(specifier) ||
        /editorStore(?:\.ts)?$/.test(specifier)
      )), path).toEqual([])
    }

    for (const path of filesUnder('src/shared/contracts')) {
      expect(importSpecifiers(source(path)).filter((specifier) => (
        /(?:^|\/)renderer\//.test(specifier) || /(?:^|\/)player\//.test(specifier)
      )), path).toEqual([])
    }
  })

  it('owns Slide Native painter and Course package analysis/preflight/emitter on single files', () => {
    const painter = source('src/player/surfaces/slide/publishedNativeRendering.ts')
    expect(painter).toContain('export function paintPublishedNativeRenderInput')
    expect(painter).toContain('freezeRenderSnapshot')
    expect(painter).toContain('readonlyNativeRenderInputFromPublishedItem')
    expect(painter).not.toMatch(/\buseEditorStore\b/)
    expect(painter).not.toMatch(/\b(?:SceneNode|ProjectDocument|schemaVersion|writer|session)\b/)
    expect(importSpecifiers(painter).filter((specifier) => (
      /editorStore|sceneAssets|renderNode|PlayerScene|projectTypes|projectSchema|course-project-v9\/schema/.test(specifier)
    ))).toEqual([])
    const slideAdapter = source('src/player/surfaces/slide/SlidePublishedAdapter.ts')
    expect(slideAdapter).toContain("from './publishedNativeRendering'")
    expect(slideAdapter).toContain('readonlyNativeRenderInputFromPublishedItem')
    expect(importSpecifiers(slideAdapter).filter((specifier) => (
      /sceneAssets|renderNode|PlayerScene|\/projectTypes|projectSchema|canvasShapeRenderer|imageEffects|publishedNativeText|publishedFormula/.test(specifier)
    ))).toEqual([])
    expect(slideAdapter).not.toMatch(/case ['"](?:text|formula|image|video|shape|teacher-controller)['"]/)

    const analysis = source('src/renderer/export/course/coursePackageScriptAnalysis.ts')
    expect(analysis).toContain("from 'acorn'")
    expect(analysis).not.toMatch(/\buseEditorStore\b/)
    expect(analysis).not.toMatch(/buildCoursePackages|zipSync|COURSE_PLAYER_CSS/)

    const preflight = source('src/renderer/export/course/coursePackagePreflight.ts')
    expect(preflight).toContain('export function collectCoursePackageExportPreflight')
    expect(preflight).not.toMatch(/\buseEditorStore\b/)
    expect(preflight).not.toMatch(/from ['"]acorn['"]/)

    const emitter = source('src/renderer/export/course/buildCoursePackages.ts')
    expect(emitter).toContain("from './coursePackageScriptAnalysis'")
    expect(emitter).toContain("from './coursePackagePreflight'")
    expect(emitter).not.toMatch(/from ['"]acorn['"]/)
    expect(emitter).not.toMatch(/\buseEditorStore\b/)
  })

  it('keeps one Zustand store, V9 history depth, and fail-loud V8 load without a second writer', () => {
    const zustandFiles = filesUnder('src').filter((path) => (
      /from ['"]zustand['"]/.test(source(path))
    ))
    expect(zustandFiles).toEqual(['src/renderer/store/editorStore.ts'])

    const srcFiles = filesUnder('src')
    expect(srcFiles.filter((path) => source(path).includes('v9HistoryToStoreHistory'))).toEqual([])
    expect(srcFiles.filter((path) => source(path).includes('migrateProjectV8ToCourseProjectV9'))).toEqual([
      'src/shared/courseProjectModel.ts',
    ])
    expect(existsSync(join(root, 'tests/helpers/projectV8.ts'))).toBe(false)

    const kernel = source('src/renderer/store/editorStoreKernel.ts')
    expect(kernel).toContain('export function storeHistoryFromSessionLengths(')
    expect(source('src/renderer/store/slices/slideAuthoringSlice.ts')).toContain('storeHistoryFromSessionLengths(')
    expect(source('src/renderer/store/slices/flowAuthoringSlice.ts')).toContain('storeHistoryFromSessionLengths(')
    expect(source('src/renderer/store/slices/spatialAuthoringSlice.ts')).toContain('storeHistoryFromSessionLengths(')

    const lifecycle = source('src/renderer/store/slices/courseLifecycleSlice.ts')
    expect(lifecycle).toContain("throw new Error('V8 工程不能打开或导入。请使用 loadCourseProject 与 Course Project V9。')")
    expect(lifecycle).not.toMatch(/\bmigrateProjectV8ToCourseProjectV9\(/)

    const consumers = editorStoreConsumers()
    expect(consumers.filter((path) => !(STORE_COMPOSITION_ADAPTERS as readonly string[]).includes(path))).toEqual([])
    expect(consumers.length).toBeLessThanOrEqual(STORE_COMPOSITION_ADAPTERS.length)
  })

  it('clears the teacher-controller Store cycle and known runtime SCCs among Store owners', () => {
    const teacher = source('src/renderer/authoring/v9TeacherControllerAuthoring.ts')
    expect(teacher).not.toMatch(/\buseEditorStore\b/)
    expect(runtimeImportSpecifiers(teacher).filter((specifier) => /editorStore/.test(specifier))).toEqual([])

    const cycles = runtimeCyclesAmong([
      'src/renderer/store/editorStore.ts',
      'src/renderer/store/editorStoreKernel.ts',
      'src/renderer/store/courseResourceState.ts',
      'src/renderer/store/slices/slideAuthoringSlice.ts',
      'src/renderer/store/slices/slideOwnedCommands.ts',
      'src/renderer/store/slices/flowAuthoringSlice.ts',
      'src/renderer/store/slices/spatialAuthoringSlice.ts',
      'src/renderer/store/slices/courseLifecycleSlice.ts',
      'src/renderer/store/slices/editorShellSlice.ts',
      'src/renderer/composition/crossSurfaceCommands.ts',
      'src/renderer/composition/surfaceRouter.ts',
      'src/renderer/authoring/v9TeacherControllerAuthoring.ts',
      'src/renderer/runtime/commitRuntimeAuthoring.ts',
      'src/renderer/media/commitCourseMediaAuthoring.ts',
      'src/renderer/components/commitComponentPackageAuthoring.ts',
      'src/renderer/interactions/commitInteractionAuthoring.ts',
    ])
    expect(cycles).toEqual([])
  })
})

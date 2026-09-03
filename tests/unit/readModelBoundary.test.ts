import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceRoute } from '@/renderer/ui/workspaces/WorkspaceRouteContext'

import {
  LEGACY_QUERY_CATALOG_DIGEST,
  LEGACY_RECORD_STATUSES,
  LEGACY_SCAN_SCOPE,
  LEGACY_SCANNER_VERSION,
  LEGACY_SCOPE_DIGEST,
} from '../../scripts/check-legacy-consumers'

describe('Read model boundary checks', () => {
  it('NodesTab does not import archive or migration modules directly', () => {
    const nodesTabPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/NodesTab.tsx',
    )
    const source = readFileSync(nodesTabPath, 'utf8')

    expect(source).not.toMatch(/courseProjectArchive/)
    expect(source).not.toMatch(/courseProjectMigration/)
    expect(source).not.toMatch(/from ['"]@\/renderer\/project\/courseProjectArchive['"]/)
    expect(source).not.toMatch(/from ['"]@\/renderer\/project\/courseProjectMigration['"]/)
    expect(source).not.toMatch(/from ['"]\.\.\/store\/slideEditorProjection['"]/)
  })

  it('properties leaf panels do not import Store, old Project/Scene, or other Surface commands', () => {
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/properties',
    )
    const files = [
      'PropertyControls.tsx',
      'SlideNativePropertiesPanel.tsx',
      'CourseGlobalPropertiesPanel.tsx',
      'RuntimePropertiesPanel.tsx',
      'FlowPropertiesPanel.tsx',
      'SpatialPropertiesPanel.tsx',
    ]
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/from ['"][^'"]*editorStore['"]/)
      expect(source, file).not.toMatch(/useEditorStore/)
      expect(source, file).not.toMatch(/slideEditorProjection/)
      expect(source, file).not.toMatch(/from ['"][^'"]*\/projectTypes['"]/)
      expect(source, file).not.toMatch(/selectActiveScene/)
      expect(source, file).not.toMatch(/spatialEditorCommands/)
      expect(source, file).not.toMatch(/spatialCameraCommands/)
      expect(source, file).not.toMatch(/spatialPathCommands/)
      expect(source, file).not.toMatch(/spatialRelationCommands/)
      expect(source, file).not.toMatch(/spatialSemanticZoom/)
    }
    const nonFlowLeaves = [
      'PropertyControls.tsx',
      'SlideNativePropertiesPanel.tsx',
      'CourseGlobalPropertiesPanel.tsx',
      'RuntimePropertiesPanel.tsx',
    ]
    for (const file of nonFlowLeaves) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/flowEditorCommands/)
    }
    const flowModules = [
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/FlowWorkspace.tsx'),
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/workspaces/FlowLocationWorkspace.tsx'),
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/flow/useFlowTextAuthoringController.ts'),
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/flow/FlowOverlayAuthoringLayer.tsx'),
      join(dir, 'FlowPropertiesPanel.tsx'),
    ]
    expect(existsSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/FlowFormulaBlockProperties.tsx',
    ))).toBe(false)
    const slideModules = [
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx'),
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/workspaces/SlideDynamicAuthoringOverlay.tsx'),
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/workspaceSlideAuthoring.ts'),
    ]
    for (const filePath of slideModules) {
      const source = readFileSync(filePath, 'utf8')
      expect(source, filePath).not.toMatch(/from ['"][^'"]*editorStore['"]/)
      expect(source, filePath).not.toMatch(/useEditorStore/)
      expect(source, filePath).not.toMatch(/from ['"][^'"]*\/projectTypes['"]/)
      expect(source, filePath).not.toMatch(/selectActiveScene/)
      expect(source, filePath).not.toMatch(/function readCandidate/)
      expect(source, filePath).not.toMatch(/function runCandidate/)
      expect(source, filePath).not.toMatch(/function v8Fallback/)
    }
    const workspaceRoot = readFileSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/Workspace.tsx',
    ), 'utf8')
    expect(workspaceRoot).not.toMatch(/playerAuthoringProtocol/)
    expect(workspaceRoot).not.toMatch(/materializeScene/)
    expect(workspaceRoot).not.toMatch(/selectActiveScene/)
    expect(workspaceRoot).not.toMatch(/slideEditorCommands/)
    for (const filePath of flowModules) {
      const source = readFileSync(filePath, 'utf8')
      expect(source, filePath).not.toMatch(
        /from ['"][^'"]*editorStore['"]/,
      )
      expect(source, filePath).not.toMatch(/useEditorStore/)
      expect(source, filePath).not.toMatch(/courseAssetSidecar/)
      expect(source, filePath).not.toMatch(/\bCourseProjectDocument\b/)
      expect(source, filePath).not.toMatch(/\bFlowCommandResult\b/)
      expect(source, filePath).not.toMatch(/\bFlowSharedAuthoringResult\b/)
      expect(source, filePath).not.toMatch(/\bnextDocument\b/)
      expect(source, filePath).not.toMatch(/executeFlowEditorCommand/)
      expect(source, filePath).not.toMatch(/updateFlowEditorBlock/)
      expect(source, filePath).not.toMatch(/commitFlowFormulaAst/)
      expect(source, filePath).not.toMatch(/importAndReplaceFlowMediaBlock/)
      expect(source, filePath).not.toMatch(/create(?:Image|Media)AssetImport/)
      expect(source, filePath).toMatch(/FlowEditorView/)
    }
    const flowProperties = readFileSync(join(dir, 'FlowPropertiesPanel.tsx'), 'utf8')
    expect(flowProperties).toMatch(/PropertyDraftBoundary/)
    expect(flowProperties).toMatch(/FlowPropertiesCommands/)
    const flowWorkspaceAdapter = readFileSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/workspaces/FlowWorkspaceConnector.tsx',
    ), 'utf8')
    expect(flowWorkspaceAdapter).toMatch(/selectRunFlowAuthoringIntent/)
    expect(flowWorkspaceAdapter).toMatch(/useEditorStore\(select/)
    expect(flowWorkspaceAdapter).not.toMatch(/getState|setState|applyFlowCommand|onProjectChange|nextDocument/)
    const propertiesRoot = readFileSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/PropertiesTab.tsx',
    ), 'utf8')
    expect(propertiesRoot).toMatch(/from ['"]\.\/properties\/PropertiesContextAdapter['"]/)
    expect(propertiesRoot).toMatch(/from ['"]\.\/properties\/PropertiesPanelRouter['"]/)
    expect(propertiesRoot.match(/usePropertiesContext\(/g)).toHaveLength(1)
    expect(propertiesRoot.match(/<PropertiesPanelRouter\b/g)).toHaveLength(1)
    expect(propertiesRoot).not.toMatch(/useEditorStore|editorStore|SurfaceCommands|AuthoringIntent/)
    expect(propertiesRoot).not.toMatch(/export\s*\{[^}]*PropertyControls/s)

    const adapterFiles = readdirSync(dir).filter((file) => (
      /PropertiesContextAdapter\.(?:ts|tsx)$/.test(file)
    ))
    expect(adapterFiles).toEqual(['PropertiesContextAdapter.tsx'])
    const propertiesAdapter = readFileSync(join(dir, adapterFiles[0]!), 'utf8')
    expect(propertiesAdapter).toMatch(/usePropertiesAuthoringBinding/)
    expect(propertiesAdapter).not.toMatch(/editorStore|useEditorStore|getState|setState/)
    expect(propertiesAdapter).not.toMatch(
      /v9Slide(?:Action|Content)Commands|spatialAuthoringIntents|flowEditorCommands|globalLayerCommands/,
    )
    expect(propertiesAdapter).not.toMatch(/CourseProjectDocument|EditorState|AuthoringSession/)
    for (const file of readdirSync(dir).filter((entry) => /\.(?:ts|tsx)$/.test(entry))) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/from ['"][^'"]*editorStore['"]|\buseEditorStore\b/)
    }
    expect(existsSync(join(dir, 'PropertiesOwnerUseCase.tsx'))).toBe(false)
    expect(existsSync(join(dir, 'PropertiesContextReadModel.ts'))).toBe(false)

    const propertiesCompositionDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/composition/properties',
    )
    const propertiesBinding = readFileSync(
      join(propertiesCompositionDir, 'usePropertiesAuthoringBinding.tsx'),
      'utf8',
    )
    const propertiesReadModel = readFileSync(
      join(propertiesCompositionDir, 'PropertiesAuthoringReadModel.ts'),
      'utf8',
    )
    expect(propertiesBinding).toMatch(/useEditorStore\(selectPropertiesAuthoringReadModel\)/)
    expect(propertiesBinding).toMatch(/commitSlideMultiLayerIntentAtTargets/)
    expect(propertiesBinding).toMatch(/runFlowAuthoringIntent/)
    expect(propertiesBinding).toMatch(/runSpatialAuthoringIntent/)
    expect(propertiesBinding).not.toMatch(
      /\b(?:updateNode|updateNodes|duplicateSelectedNodes|deleteSelectedNodes|createLocalTextCommands|localTextDraftRef)\b/,
    )
    expect(propertiesReadModel).toMatch(/selectPropertiesAuthoringReadModel/)
    expect(propertiesReadModel).toMatch(/type EditorState/)

    for (const file of [
      'FlowPropertiesContextBuilder.ts',
      'RuntimePropertiesContextBuilder.ts',
      'SpatialPropertiesContextBuilder.ts',
    ]) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/editorStore|useEditorStore|getState|setState/)
      expect(source, file).not.toMatch(/CourseProjectDocument|EditorState/)
    }
    const spatialModules = [
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx'),
      join(dir, 'SpatialPropertiesPanel.tsx'),
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/SpatialCameraPanel.tsx'),
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/SpatialPathEditor.tsx'),
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/authoring/spatialWorldTargetAuthoring.ts'),
    ]
    for (const filePath of spatialModules) {
      const source = readFileSync(filePath, 'utf8')
      expect(source, filePath).not.toMatch(/from ['"][^'"]*editorStore['"]/)
      expect(source, filePath).not.toMatch(/useEditorStore/)
      expect(source, filePath).not.toMatch(/from ['"][^'"]*\/projectTypes['"]/)
      expect(source, filePath).not.toMatch(/slideEditorProjection/)
      expect(source, filePath).not.toMatch(/selectActiveScene/)
      expect(source, filePath).not.toMatch(/selectEditingNodes/)
      expect(source, filePath).not.toMatch(/selectSelectedNode/)
      expect(source, filePath).not.toMatch(/FlowEditorSelection/)
      expect(source, filePath).not.toMatch(/flowEditorCommands/)
      expect(source, filePath).not.toMatch(/commitSpatialProjectMutation/)
      expect(source, filePath).not.toMatch(/history\.present\.camera/)
      expect(source, filePath).not.toMatch(/SpatialWorldAuthoringHost/)
      expect(source, filePath).not.toMatch(/\bgetSession\b|\bsetSession\b/)
      expect(source, filePath).not.toMatch(/runSpatialCommand|applySpatialAuthoringSession/)
    }
    const spatialWorkspaceAdapter = readFileSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/workspaces/SpatialWorkspaceConnector.tsx',
    ), 'utf8')
    expect(spatialWorkspaceAdapter).toMatch(/selectRunSpatialAuthoringIntent/)
    expect(spatialWorkspaceAdapter).toMatch(/useEditorStore\(select/)
    expect(spatialWorkspaceAdapter).not.toMatch(/getState|setState/)
    expect(spatialWorkspaceAdapter).not.toMatch(/runSpatialCommand|applySpatialAuthoringSession/)

    const slideWorkspace = readFileSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx',
    ), 'utf8')
    const slideConnector = readFileSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/workspaces/SlideWorkspaceConnector.tsx',
    ), 'utf8')
    const slideAuthoring = readFileSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/ui/workspaceSlideAuthoring.ts',
    ), 'utf8')
    const editorStore = readFileSync(join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/store/editorStore.ts',
    ), 'utf8')
    expect(slideWorkspace).not.toMatch(/liveStore|CourseProjectDocument|readonly project:/)
    expect(slideWorkspace).toMatch(/readonly snapshot: SlideWorkspaceSnapshot/)
    expect(slideWorkspace).toMatch(/readonly ports: SlideWorkspacePorts/)
    expect(slideConnector).not.toMatch(/\bEditorState\b|getState|setState/)
    expect(slideAuthoring).not.toMatch(/bindSlideWorkspaceAuthoringPorts|installedPorts|MISSING_PORTS/)
    expect(editorStore).not.toMatch(/ui\/workspaceSlideAuthoring|bindSlideWorkspaceAuthoringPorts/)
  })

  it('Workspace route fails loud when more than one Surface session is active', () => {
    expect(resolveWorkspaceRoute({
      hasSlideSession: false,
      hasFlowSession: true,
      hasSpatialSession: true,
      expectedSurfaceType: 'flow',
      locationSurfaceType: 'flow',
    })).toEqual(expect.objectContaining({ kind: 'conflict' }))
    expect(resolveWorkspaceRoute({
      hasSlideSession: false,
      hasFlowSession: false,
      hasSpatialSession: false,
      expectedSurfaceType: 'flow',
      locationSurfaceType: 'spatial-2d',
    })).toEqual(expect.objectContaining({ kind: 'conflict' }))
  })

  it('reads the unique legacy inventory structure and status enum', () => {
    const inventoryPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../docs/development-plan/inventories/legacy-consumers.json',
    )
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
      schemaVersion: number
      scannerContract: {
        version: string
        scope: unknown
        scopeDigest: string
        queryCatalogDigest: string
      }
      baseline: {
        reconciledProductCommit?: string
        reconciledProductTreeDigest?: string
      }
      records: Array<{
        id: string
        status: string
        legacyTargets: Array<{
          expectationId: string
          path: string
          expectation: string
          symbols?: string[]
        }>
        consumerCategories: Record<string, { confirmed: unknown[]; unknowns: unknown[] }>
      }>
    }
    expect(inventory.schemaVersion).toBe(2)
    expect(inventory.scannerContract).toEqual({
      version: LEGACY_SCANNER_VERSION,
      scope: LEGACY_SCAN_SCOPE,
      scopeDigest: LEGACY_SCOPE_DIGEST,
      queryCatalogDigest: LEGACY_QUERY_CATALOG_DIGEST,
    })
    expect(inventory.baseline.reconciledProductCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(inventory.baseline.reconciledProductTreeDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(inventory.records.length).toBeGreaterThan(0)
    for (const record of inventory.records) {
      expect(LEGACY_RECORD_STATUSES).toContain(record.status)
      expect(record.legacyTargets.length).toBeGreaterThan(0)
      for (const target of record.legacyTargets) {
        expect(target.expectationId).toMatch(/^LEG-\d{3}-/)
        expect(['file-absent', 'symbol-absent']).toContain(target.expectation)
        if (target.expectation === 'symbol-absent') expect(target.symbols?.length).toBeGreaterThan(0)
      }
      expect(record.consumerCategories.staticImportsOrReferences.confirmed).toBeInstanceOf(Array)
    }
  })

  it('App lifecycle module does not import root Store, Preview/Export builders, or old Project/V8 adapters', () => {
    const lifecyclePath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/app/useCourseProjectLifecycle.ts',
    )
    const source = readFileSync(lifecyclePath, 'utf8')
    expect(source).not.toMatch(/from ['"][^'"]*editorStore['"]/)
    expect(source).not.toMatch(/useEditorStore/)
    expect(source).not.toMatch(/from ['"][^'"]*\/export\//)
    expect(source).not.toMatch(/buildPublishedCourse/)
    expect(source).not.toMatch(/buildCoursePackages/)
    expect(source).not.toMatch(/buildCoursePptx/)
    expect(source).not.toMatch(/buildCoursePrintArtifacts/)
    expect(source).not.toMatch(/coursePlayerTryRun/)
    expect(source).not.toMatch(/from ['"][^'"]*\/projectArchive['"]/)
    expect(source).not.toMatch(/from ['"][^'"]*\/projectTypes['"]/)
    expect(source).not.toMatch(/\bProjectDocument\b/)
    expect(source).toMatch(/openDefaultCourseProjectAsync/)
    expect(source).toMatch(/saveCourseProjectDocumentAsync/)
    expect(source).toMatch(/RecoveryWriteCoordinator/)
  })

  it('App.tsx no longer implements archive build, save single-flight, draft ack, or Recovery effects', () => {
    const appPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/App.tsx',
    )
    const source = readFileSync(appPath, 'utf8')
    expect(source).toMatch(/useCourseProjectLifecycle/)
    expect(source).not.toMatch(/saveInFlightRef/)
    expect(source).not.toMatch(/saveCourseProjectDocumentAsync/)
    expect(source).not.toMatch(/openDefaultCourseProjectAsync/)
    expect(source).not.toMatch(/RecoveryWriteCoordinator/)
    expect(source).not.toMatch(/createRecoveryWriteCoordinator/)
    expect(source).not.toMatch(/courseArchiveDataFromSnapshot/)
    expect(source).not.toMatch(/shouldOfferCourseProjectRecovery/)
    expect(source).not.toMatch(/recoveryCoordinatorRef/)
    expect(source).not.toMatch(/recoveryRevisionRef/)
    expect(source).not.toMatch(/recoveryDecisionComplete/)
    expect(source).not.toMatch(/coordinator\.schedule\(/)
  })

  it('App delivery module composes producers without root Store, ExportPayload, or PlayerApp', () => {
    const deliveryPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/app/useCourseDelivery.ts',
    )
    const source = readFileSync(deliveryPath, 'utf8')
    expect(source).not.toMatch(/from ['"][^'"]*editorStore['"]/)
    expect(source).not.toMatch(/useEditorStore/)
    expect(source).not.toMatch(/EditorState\.project/)
    expect(source).not.toMatch(/\bExportPayload\b/)
    expect(source).not.toMatch(/\bPlayerApp\b/)
    expect(source).toMatch(/buildPublishedCourseStandaloneHtml/)
    expect(source).toMatch(/buildPublishedCourseWebPackageAsync/)
    expect(source).toMatch(/buildCoursePptx/)
    expect(source).toMatch(/buildCoursePrintArtifacts/)
    expect(source).toMatch(/buildFlowDocx/)
    expect(source).toMatch(/collectCourseProjectExportPreflight/)
    expect(source).toMatch(/mountPublishedCourseTryRun/)
  })

  it('App.tsx does not import format builders and no longer owns Preview/Export handlers', () => {
    const appPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/App.tsx',
    )
    const source = readFileSync(appPath, 'utf8')
    expect(source).toMatch(/useCourseDelivery/)
    expect(source).not.toMatch(/buildPublishedCourseStandaloneHtml/)
    expect(source).not.toMatch(/buildPublishedCourseWebPackageAsync/)
    expect(source).not.toMatch(/\bbuildCoursePptx\b/)
    expect(source).not.toMatch(/buildCoursePrintArtifacts/)
    expect(source).not.toMatch(/\bbuildFlowDocx\b/)
    expect(source).not.toMatch(/buildPublishedCourseV2Payload/)
    expect(source).not.toMatch(/from ['"][^'"]*buildCoursePackages['"]/)
    expect(source).not.toMatch(/from ['"][^'"]*buildCoursePptx['"]/)
    expect(source).not.toMatch(/from ['"][^'"]*buildCoursePrintArtifacts['"]/)
    expect(source).not.toMatch(/from ['"][^'"]*flowDocx['"]/)
    expect(source).not.toMatch(/from ['"][^'"]*buildPublishedCourse['"]/)
    expect(source).not.toMatch(/activeCoursePublishSources/)
    expect(source).not.toMatch(/courseDeliveryUnavailable/)
    expect(source).not.toMatch(/const handleExportHtml/)
    expect(source).not.toMatch(/const handleExportPptx/)
    expect(source).not.toMatch(/const handleExportPdf/)
    expect(source).not.toMatch(/const handleExportDocx/)
    expect(source).not.toMatch(/const handleExportWebPackage/)
    expect(source).not.toMatch(/const handlePreview/)
  })

  it('App import and keyboard modules do not import root Store or copy planners', () => {
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/app',
    )
    const files = [
      'useMediaImport.ts',
      'useComponentLibrary.ts',
      'useEditorKeyboardRouter.ts',
    ]
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(/from ['"][^'"]*editorStore['"]/)
      expect(source, file).not.toMatch(/useEditorStore/)
    }
    const media = readFileSync(join(dir, 'useMediaImport.ts'), 'utf8')
    expect(media).toMatch(/prepareHashedMediaBatch/)
    expect(media).toMatch(/planMediaBatchImport/)
    expect(media).toMatch(/commitMediaBatchImport/)
    expect(media).not.toMatch(/function buildAssetContentHashIndex/)
    const components = readFileSync(join(dir, 'useComponentLibrary.ts'), 'utf8')
    expect(components).toMatch(/planCatalogBatchJoin/)
    expect(components).toMatch(/importComponentPackageAsync/)
    expect(components).not.toMatch(/function planCatalogBatchJoin/)
    const keyboard = readFileSync(join(dir, 'useEditorKeyboardRouter.ts'), 'utf8')
    expect(keyboard).toMatch(/resolveKeyboardDeleteDisposition/)
    expect(keyboard).toMatch(/routeEditorAction/)
    expect(keyboard).not.toMatch(/saveCourseProjectDocumentAsync/)
    expect(keyboard).not.toMatch(/openDefaultCourseProjectAsync/)
  })

  it('App.tsx does not keep media/component planners or Surface-forked keydown rules', () => {
    const appPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/renderer/App.tsx',
    )
    const source = readFileSync(appPath, 'utf8')
    expect(source).toMatch(/useMediaImport/)
    expect(source).toMatch(/useComponentLibrary/)
    expect(source).toMatch(/useEditorKeyboardRouter/)
    expect(source).not.toMatch(/planMediaBatchImport/)
    expect(source).not.toMatch(/createImageAssetImport/)
    expect(source).not.toMatch(/createMediaAssetImport/)
    expect(source).not.toMatch(/prepareHashedMediaBatch/)
    expect(source).not.toMatch(/prepareAssetBatch/)
    expect(source).not.toMatch(/buildAssetContentHashIndex/)
    expect(source).not.toMatch(/dedupeCourseMediaImports/)
    expect(source).not.toMatch(/commitMediaBatchImport/)
    expect(source).not.toMatch(/importComponentPackageAsync/)
    expect(source).not.toMatch(/planCatalogBatchJoin/)
    expect(source).not.toMatch(/componentCatalogInstallStatus/)
    expect(source).not.toMatch(/shouldIgnoreSlideLayerDeleteForFocus/)
    expect(source).not.toMatch(/window\.addEventListener\('keydown'/)
    expect(source).not.toMatch(/event\.key === 'Delete'/)
    expect(source).not.toMatch(/event\.key === 'Backspace'/)
    expect(source).not.toMatch(/resolveKeyboardDeleteDisposition/)
  })

  it('editor store composition root no longer owns V8 project, sidecar names, or teacher-controller Store import', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
    const store = readFileSync(join(root, 'src/renderer/store/editorStore.ts'), 'utf8')
    expect(store).not.toMatch(/^  project: ProjectDocument$/m)
    expect(store).not.toMatch(/slideCandidateSidecar/)
    expect(store).not.toMatch(/derivedV8ProjectFrom/)
    expect(store).not.toMatch(/projectCandidatePreviewDocument/)
    expect(store).not.toMatch(/\bproduce\(/)
    expect(store).not.toMatch(/\bcreateCourseProjectArchive\b/)
    expect(store).not.toMatch(/\bopenCourseProjectArchive\b/)
    const teacher = readFileSync(
      join(root, 'src/renderer/authoring/v9TeacherControllerAuthoring.ts'),
      'utf8',
    )
    expect(teacher).not.toMatch(/useEditorStore/)
    expect(teacher).toMatch(/TeacherControllerAuthoringPorts/)
    expect(readFileSync(join(root, 'src/renderer/store/slices/slideAuthoringSlice.ts'), 'utf8'))
      .toMatch(/persistSlideCandidateResult/)
    expect(readFileSync(join(root, 'src/renderer/store/slices/flowAuthoringSlice.ts'), 'utf8'))
      .toMatch(/persistFlowResult/)
    expect(readFileSync(join(root, 'src/renderer/store/slices/spatialAuthoringSlice.ts'), 'utf8'))
      .toMatch(/persistSpatialResult/)
    expect(readFileSync(join(root, 'src/renderer/composition/surfaceRouter.ts'), 'utf8'))
      .toMatch(/planActivateCourseLocation/)
    expect(readFileSync(join(root, 'src/renderer/runtime/commitRuntimeAuthoring.ts'), 'utf8'))
      .not.toMatch(/useEditorStore/)
    expect(readFileSync(join(root, 'src/renderer/media/commitCourseMediaAuthoring.ts'), 'utf8'))
      .not.toMatch(/useEditorStore/)
    expect(readFileSync(join(root, 'src/renderer/components/commitComponentPackageAuthoring.ts'), 'utf8'))
      .not.toMatch(/useEditorStore/)
    expect(readFileSync(join(root, 'src/renderer/interactions/commitInteractionAuthoring.ts'), 'utf8'))
      .not.toMatch(/useEditorStore/)
    expect(readFileSync(join(root, 'src/renderer/store/editorStore.ts'), 'utf8'))
      .toMatch(/\.\.\.runtimeAuthoringActions/)
    const createIndex = store.indexOf('export const useEditorStore = create<EditorState>((set, get) => {')
    const selectIndex = store.indexOf('export const selectActiveScene')
    expect(createIndex).toBeGreaterThanOrEqual(0)
    expect(selectIndex).toBeGreaterThan(createIndex)
    expect(store).toMatch(/\.\.\.slideAuthoringSlice/)
    expect(store).toMatch(/\.\.\.crossSurfaceCommands/)
    expect(store.slice(createIndex, selectIndex)).not.toMatch(/\bplan[A-Z]\w+\(/)
    expect(store.slice(createIndex, selectIndex)).not.toMatch(
      /\b(?:addSlide(?:Text|Image|Video|Shape|Formula|Component)Layer|executeFlowEditorCommand|commitSlideProjectMutation)\(/,
    )
  })

  it('Workspace routes Surface shells and PropertiesTab routes leaf panels', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
    const workspace = readFileSync(join(root, 'src/renderer/ui/Workspace.tsx'), 'utf8')
    expect(workspace).toMatch(/from ['"]\.\/workspaces\/SlideWorkspaceConnector['"]/)
    expect(workspace).toMatch(/from ['"]\.\/workspaces\/FlowWorkspaceConnector['"]/)
    expect(workspace).toMatch(/from ['"]\.\/workspaces\/SpatialWorkspaceConnector['"]/)
    expect(workspace).toMatch(/useWorkspaceRoute/)
    expect(workspace).not.toMatch(/editorStore|getState|setState|build(?:Slide|Flow|Spatial)EditorView|mountPublished/)
    const properties = readFileSync(join(root, 'src/renderer/ui/PropertiesTab.tsx'), 'utf8')
    expect(properties).toMatch(/from ['"]\.\/properties\/PropertiesContextAdapter['"]/)
    expect(properties).toMatch(/from ['"]\.\/properties\/PropertiesPanelRouter['"]/)
    expect(properties).not.toMatch(/(?:SlideNative|Flow|Spatial|CourseGlobal)PropertiesPanel/)
    const router = readFileSync(
      join(root, 'src/renderer/ui/properties/PropertiesPanelRouter.tsx'),
      'utf8',
    )
    expect(router).toMatch(/from ['"]\.\/SlideNativePropertiesPanel['"]/)
    expect(router).toMatch(/from ['"]\.\/FlowPropertiesPanel['"]/)
    expect(router).toMatch(/from ['"]\.\/SpatialPropertiesPanel['"]/)
    expect(router).toMatch(/from ['"]\.\/CourseGlobalPropertiesPanel['"]/)
    expect(router).not.toMatch(/editorStore|useEditorStore|AuthoringIntent/)
  })

  it('App health path uses Course Project V9 collector, not V8 collectProjectHealth', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
    const app = readFileSync(join(root, 'src/renderer/App.tsx'), 'utf8')
    expect(app).toMatch(/collectCourseProjectHealth/)
    expect(app).not.toMatch(/\bcollectProjectHealth\b/)
    const panel = readFileSync(join(root, 'src/renderer/ui/ProjectHealthPanel.tsx'), 'utf8')
    expect(panel).toMatch(/collectCourseProjectHealth/)
    expect(panel).not.toMatch(/\bcollectProjectHealth\b/)
  })

  it('product loadProject is fail-loud and the shared model has no V8 migration helper', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
    const lifecycle = readFileSync(
      join(root, 'src/renderer/store/slices/courseLifecycleSlice.ts'),
      'utf8',
    )
    expect(lifecycle).toMatch(/V8 工程不能打开或导入/)
    expect(lifecycle).not.toMatch(/migrateProjectV8ToCourseProjectV9/)
    const model = readFileSync(join(root, 'src/shared/courseProjectModel.ts'), 'utf8')
    expect(model).not.toMatch(/migrateProjectV8ToCourseProjectV9/)
  })
})

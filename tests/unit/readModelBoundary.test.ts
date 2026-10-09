import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceRoute } from '@/renderer/ui/workspaces/WorkspaceRouteContext'
import type { CourseProjectV10 } from '@/shared/contracts/component-platform'
import { LEGACY_QUERY_CATALOG_DIGEST, LEGACY_RECORD_STATUSES, LEGACY_SCAN_SCOPE, LEGACY_SCANNER_VERSION, LEGACY_SCOPE_DIGEST } from '../../scripts/check-legacy-consumers'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = (path: string) => readFileSync(join(root, 'src/renderer', path), 'utf8')

describe('current read models and authoring ownership boundaries', () => {
  it('keeps property and workspace leaves independent of Store, archive and retired Surface writers', () => {
    const leaves = ['ui/properties/PropertyControls.tsx', 'ui/properties/SlideNativePropertiesPanel.tsx',
      'ui/properties/CourseGlobalPropertiesPanel.tsx', 'ui/properties/RuntimePropertiesPanel.tsx',
      'ui/properties/FlowPropertiesPanel.tsx', 'ui/properties/SpatialPropertiesPanel.tsx',
      'ui/workspaces/SlideLocationWorkspace.tsx', 'ui/workspaces/SlideDynamicAuthoringOverlay.tsx',
      'ui/workspaceSlideAuthoring.ts', 'ui/workspaces/FlowLocationWorkspace.tsx',
      'ui/flow/useFlowTextAuthoringController.ts']
    expect(existsSync(join(root, 'src/renderer/ui/flow/FlowOverlayAuthoringLayer.tsx'))).toBe(false)
    for (const file of leaves) {
      expect(source(file), file).not.toMatch(/from ['"][^'"]*editorStore['"]|useEditorStore|slideEditorProjection/)
      expect(source(file), file).not.toMatch(/from ['"][^'"]*\/projectTypes['"]|selectActiveScene|\bCourseProjectDocument\b/)
      expect(source(file), file).not.toMatch(/spatialEditorCommands|spatialCameraCommands|spatialPathCommands|spatialRelationCommands|spatialSemanticZoom/)
      expect(source(file), file).not.toMatch(/executeFlowEditorCommand|updateFlowEditorBlock|commitFlowFormulaAst|importAndReplaceFlowMediaBlock|courseAssetSidecar|\bnextDocument\b/)
    }
    expect(source('ui/NodesTab.tsx')).not.toMatch(/courseProjectArchive|courseProjectMigration|slideEditorProjection/)
    expect(source('ui/Workspace.tsx')).not.toMatch(/editorStore|getState|setState|playerAuthoringProtocol|materializeScene|selectActiveScene|slideEditorCommands|mountPublished/)
    expect(source('ui/PropertiesTab.tsx')).not.toMatch(/(?:SlideNative|Flow|Spatial|CourseGlobal)PropertiesPanel/)
    expect(source('ui/properties/PropertiesPanelRouter.tsx')).not.toMatch(/editorStore|useEditorStore|AuthoringIntent/)
    // FlowWorkspace is the current composition entry: its Store selectors obtain the
    // shared Bridge/Kernel and draft owners, while formal edits use captured commands.
    const flow = source('ui/FlowWorkspace.tsx')
    expect(flow).toMatch(/state => state\.courseBridge/); expect(flow).toMatch(/state => state\.courseKernel/)
    expect(flow).not.toMatch(/setState|\bCourseProjectDocument\b|executeFlowEditorCommand|updateFlowEditorBlock|courseAssetSidecar|\bnextDocument\b/)
  })

  it('keeps the application composition and Store free of retired schemas, archive writers and duplicated lifecycle ownership', () => {
    for (const file of ['app/useCourseProjectLifecycle.ts', 'app/useCourseDelivery.ts', 'app/useMediaImport.ts',
      'app/useComponentLibrary.ts', 'app/useEditorKeyboardRouter.ts', 'runtime/commitRuntimeAuthoring.ts',
      'media/commitCourseMediaAuthoring.ts', 'components/commitComponentPackageAuthoring.ts', 'interactions/commitInteractionAuthoring.ts']) {
      expect(source(file), file).not.toMatch(/from ['"][^'"]*editorStore['"]|useEditorStore/)
      expect(source(file), file).not.toMatch(/from ['"][^'"]*\/projectTypes['"]|\bProjectDocument\b/)
    }
    const lifecycle = source('app/useCourseProjectLifecycle.ts')
    expect(lifecycle).not.toMatch(/from ['"][^'"]*\/export\/|buildPublishedCourse|coursePlayerTryRun|openDefaultCourseProjectAsync|saveCourseProjectDocumentAsync|RecoveryWriteCoordinator/)
    expect(source('app/useCourseDelivery.ts')).not.toMatch(/EditorState\.project|\bExportPayload\b|\bPlayerApp\b/)
    const app = source('App.tsx')
    expect(app).not.toMatch(/saveInFlightRef|saveCourseProjectDocumentAsync|openDefaultCourseProjectAsync|RecoveryWriteCoordinator|createRecoveryWriteCoordinator|courseArchiveDataFromSnapshot|shouldOfferCourseProjectRecovery|recoveryCoordinatorRef|recoveryRevisionRef|recoveryDecisionComplete|coordinator\.schedule\(/)
    expect(app).not.toMatch(/buildPublishedCourseStandaloneHtml|buildPublishedCourseWebPackageAsync|\bbuildCoursePptx\b|buildCoursePrintArtifacts|\bbuildFlowDocx\b|buildPublishedCourseV2Payload|activeCoursePublishSources|courseDeliveryUnavailable|const handleExport(?:Html|Pptx|Pdf|Docx|WebPackage)|const handlePreview/)
    expect(app).not.toMatch(/planMediaBatchImport|createImageAssetImport|createMediaAssetImport|prepareHashedMediaBatch|prepareAssetBatch|buildAssetContentHashIndex|dedupeCourseMediaImports|commitMediaBatchImport|importComponentPackageAsync|planCatalogBatchJoin|componentCatalogInstallStatus|shouldIgnoreSlideLayerDeleteForFocus|window\.addEventListener\('keydown'|event\.key === '(?:Delete|Backspace)'|resolveKeyboardDeleteDisposition|\bcollectProjectHealth\b/)
    const store = source('store/editorStore.ts')
    expect(store).not.toMatch(/CourseV9Driver|schemaVersion:\s*9|slideCandidateSidecar|derivedV8ProjectFrom|projectCandidatePreviewDocument|\bproduce\(|\bcreateCourseProjectArchive\b|\bopenCourseProjectArchive\b/)
    const composition = store.slice(store.indexOf('export const useEditorStore = create<EditorState>'), store.indexOf('export const selectActiveScene'))
    expect(composition).not.toMatch(/\bplan[A-Z]\w+\(|\b(?:addSlide(?:Text|Image|Video|Shape|Formula|Component)Layer|executeFlowEditorCommand|commitSlideProjectMutation)\(/)
    expect(source('store/slices/courseLifecycleSlice.ts')).not.toMatch(/migrateProjectV8ToCourseProjectV9/)
    expect(readFileSync(join(root, 'src/shared/courseProjectModel.ts'), 'utf8')).not.toMatch(/migrateProjectV8ToCourseProjectV9/)
    expect(source('components/teacherControllerComponent.ts')).not.toMatch(/useEditorStore/)
  })

  it('routes the single V10 surface identity for all three projections and rejects unavailable targets', () => {
    const project: CourseProjectV10 = { schemaVersion: 10, id: 'route', title: 'Mixed', revision: 0, definitions: {}, instances: {},
      surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: [] }, { id: 'flow', kind: 'flow', title: 'Flow', childIds: [] },
        { id: 'spatial', kind: 'spatial', title: 'Spatial', childIds: [] }], global: { underlay: [], overlay: [] }, assets: {} }
    for (const surface of project.surfaces) expect(resolveWorkspaceRoute({ project, surfaceId: surface.id })).toEqual({ kind: surface.kind })
    for (const signals of [{ project, surfaceId: 'deleted' }, { project, surfaceId: null }, { project: null, surfaceId: 'slide' }])
      expect(resolveWorkspaceRoute(signals)).toMatchObject({ kind: 'conflict' })
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

})

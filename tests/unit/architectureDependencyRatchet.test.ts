import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { act, renderHook, waitFor } from '@testing-library/react'
import { API, type Snapshot } from 'typescript/unstable/sync'
import {
  SyntaxKind,
  isArrowFunction,
  isBinaryExpression,
  isCallExpression,
  isExportDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isMethodDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceExport,
  isNamespaceImport,
  isNewExpression,
  isPrivateIdentifier,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
  type Block,
  type ConciseBody,
  type ImportClause,
  type Node,
  type SourceFile,
} from 'typescript/unstable/ast'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AvailableComponentCatalogPackage } from '@/shared/componentCatalog'
import type { ComponentPackageData } from '@/shared/componentTypes'
import {
  useComponentLibrary,
  type ComponentLibraryPorts,
} from '@/renderer/app/useComponentLibrary'
import {
  useMediaImport,
  type MediaImportPorts,
} from '@/renderer/app/useMediaImport'

const root = resolve(__dirname, '..', '..')
const sourcePathByText = new Map<string, string>()
const parsedSources = new Map<string, SourceFile>()
let typeScriptApi: API | undefined
let typeScriptSnapshot: Snapshot | undefined

beforeAll(() => {
  typeScriptApi = new API({ cwd: root })
  typeScriptSnapshot = typeScriptApi.updateSnapshot({
    openProjects: [
      join(root, 'tsconfig.json'),
      join(root, 'tsconfig.electron.json'),
    ],
  })
  for (const project of typeScriptSnapshot.getProjects()) {
    for (const sourceName of project.program.getSourceFileNames()) {
      const path = relative(root, resolve(sourceName)).replace(/\\/g, '/')
      if (path === '..' || path.startsWith('../')) continue
      const parsed = project.program.getSourceFile(sourceName)
      if (parsed) parsedSources.set(path, parsed)
    }
  }
}, 60_000)

afterAll(() => {
  typeScriptSnapshot?.dispose()
  typeScriptApi?.close()
})

function source(path: string): string {
  const text = readFileSync(join(root, path), 'utf8')
  sourcePathByText.set(text, path.replace(/\\/g, '/'))
  return text
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

interface ModuleReference {
  readonly specifier: string
  readonly runtime: boolean
}

function parsedSource(text: string): SourceFile {
  const path = sourcePathByText.get(text)
  const parsed = path ? parsedSources.get(path) : undefined
  if (!parsed) throw new Error(`TypeScript AST is unavailable for ${path ?? 'inline source'}`)
  return parsed
}

function importClauseHasRuntimeValue(clause: ImportClause | undefined): boolean {
  if (!clause) return true
  if (clause.phaseModifier === SyntaxKind.TypeKeyword) return false
  if (clause.name || (clause.namedBindings && isNamespaceImport(clause.namedBindings))) return true
  return clause.namedBindings && isNamedImports(clause.namedBindings)
    ? clause.namedBindings.elements.some((element) => !element.isTypeOnly)
    : false
}

function moduleReferences(text: string): ModuleReference[] {
  const parsed = parsedSource(text)
  const result: ModuleReference[] = []
  const visit = (node: Node): void => {
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      result.push({
        specifier: node.moduleSpecifier.text,
        runtime: importClauseHasRuntimeValue(node.importClause),
      })
    } else if (isExportDeclaration(node) && node.moduleSpecifier && isStringLiteral(node.moduleSpecifier)) {
      const hasRuntimeValue = !node.isTypeOnly && (
        !node.exportClause
        || isNamespaceExport(node.exportClause)
        || (isNamedExports(node.exportClause)
          && node.exportClause.elements.some((element) => !element.isTypeOnly))
      )
      result.push({ specifier: node.moduleSpecifier.text, runtime: hasRuntimeValue })
    } else if (
      isCallExpression(node)
      && node.expression.kind === SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && isStringLiteral(node.arguments[0]!)
    ) {
      result.push({ specifier: node.arguments[0]!.text, runtime: true })
    }
    node.forEachChild((child) => {
      visit(child)
      return undefined
    })
  }
  visit(parsed)
  return result
}

function importSpecifiers(text: string): string[] {
  return moduleReferences(text).map(({ specifier }) => specifier)
}

function runtimeImportSpecifiers(text: string): string[] {
  return moduleReferences(text)
    .filter(({ runtime }) => runtime)
    .map(({ specifier }) => specifier)
}

function namedFunctionBody(text: string, name: string): string {
  const parsed = parsedSource(text)
  let body: ConciseBody | Block | undefined
  const visit = (node: Node): void => {
    if (body) return
    if (
      (isFunctionDeclaration(node) || isMethodDeclaration(node))
      && node.name
      && isIdentifier(node.name)
      && node.name.text === name
      && node.body
    ) {
      body = node.body
      return
    }
    if (
      isVariableDeclaration(node)
      && isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
      && (isArrowFunction(node.initializer) || isFunctionExpression(node.initializer))
    ) {
      body = node.initializer.body
      return
    }
    node.forEachChild((child) => {
      visit(child)
      return undefined
    })
  }
  visit(parsed)
  expect(body, `function ${name}`).toBeDefined()
  return body!.getText(parsed)
}

function namedVariableInitializer(text: string, name: string): string {
  const parsed = parsedSource(text)
  let initializer: Node | undefined
  const visit = (node: Node): void => {
    if (initializer) return
    if (
      isVariableDeclaration(node)
      && isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) {
      initializer = node.initializer
      return
    }
    node.forEachChild((child) => {
      visit(child)
      return undefined
    })
  }
  visit(parsed)
  expect(initializer, `variable ${name}`).toBeDefined()
  return initializer!.getText(parsed)
}

function containsIdentifier(text: string, name: string): boolean {
  const parsed = parsedSource(text)
  let found = false
  const visit = (node: Node): void => {
    if (found) return
    if (isIdentifier(node) && node.text === name) {
      found = true
      return
    }
    node.forEachChild((child) => {
      visit(child)
      return undefined
    })
  }
  visit(parsed)
  return found
}

function exportedFunctionNames(text: string): string[] {
  const parsed = parsedSource(text)
  return parsed.statements.flatMap((statement) => {
    if (!isFunctionDeclaration(statement) || !statement.name) return []
    const modifiers = 'modifiers' in statement ? statement.modifiers : undefined
    const exported = Array.isArray(modifiers)
      && modifiers.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword)
    return exported ? [statement.name.text] : []
  })
}

function constructedControllerTargets(text: string): string[] {
  const parsed = parsedSource(text)
  const targets = new Set<string>()
  const visit = (node: Node): void => {
    if (
      isNewExpression(node)
      && isIdentifier(node.expression)
      && node.expression.text === 'PublishedInteractionController'
      && isBinaryExpression(node.parent)
      && node.parent.operatorToken.kind === SyntaxKind.EqualsToken
      && isPropertyAccessExpression(node.parent.left)
      && node.parent.left.expression.kind === SyntaxKind.ThisKeyword
      && isPrivateIdentifier(node.parent.left.name)
    ) {
      targets.add(node.parent.left.name.getText(parsed))
    }
    node.forEachChild((child) => {
      visit(child)
      return undefined
    })
  }
  visit(parsed)
  return [...targets].sort()
}

function isStoreCompositionAdapter(path: string): boolean {
  return path === 'src/renderer/App.tsx'
    || path === 'src/renderer/main.tsx'
    || /^src\/renderer\/(?:composition|dev|diagnostics|ui)\//.test(path)
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  const absolute = specifier.startsWith('@/')
    ? resolve(root, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(join(root, fromFile, '..'), specifier)
      : null
  if (!absolute) return null
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
    return importSpecifiers(source(path)).some((specifier) => /editorStore(?:\.ts)?$/.test(specifier))
  })
}

function directedCycles(edges: ReadonlyMap<string, readonly string[]>): string[] {
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
  for (const file of edges.keys()) visit(file)
  return cycles
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
  return directedCycles(edges)
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

    const useCase = namedFunctionBody(media, 'commitCourseImageReplacement')
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

    expect(namedFunctionBody(media, 'importAssets')).not.toContain('importCourseMediaAssets')

    const replacement = namedFunctionBody(components, 'replaceComponentPackage')
    expect(replacement).toContain('commitComponentReplacementAtTarget(')
    expect(replacement).not.toMatch(/runV9DocumentMutation|\bcommit\(/)
  })

  it('captures async App targets before Media and Components package reads', async () => {
    const mediaEvents: string[] = []
    const mediaPorts: MediaImportPorts = {
      captureIdentity: () => null,
      captureLibraryTarget: () => {
        mediaEvents.push('capture-library-target')
        return { projectId: 'project-1', documentRevision: 1 }
      },
      captureImageReplacementTarget: () => null,
      readMediaLibrarySnapshot: () => ({ assets: {}, files: {} }),
      readCandidateMediaContext: () => null,
      replaceImageAtTarget: () => ({ ok: true }),
      importAssetsAtTarget: () => ({ ok: true }),
      placeImageNodes: () => [],
      placeVideoNodes: () => [],
      importSounds: () => undefined,
      commitCandidateMedia: () => undefined,
      selectImage: async () => null,
      selectImages: async () => {
        mediaEvents.push('read-image-package')
        return null
      },
      selectAudios: async () => null,
      selectVideos: async () => {
        mediaEvents.push('read-video-package')
        return null
      },
      async runBusy<T>(operation: () => Promise<T>): Promise<T | undefined> {
        try {
          return await operation()
        } catch {
          return undefined
        }
      },
      commitStatus: () => undefined,
      reportError: () => undefined,
    }
    const mediaHook = renderHook(() => useMediaImport(mediaPorts))
    await act(async () => mediaHook.result.current.selectAndImportImage('library'))
    expect(mediaEvents).toEqual(['capture-library-target', 'read-image-package'])
    mediaEvents.length = 0
    await act(async () => mediaHook.result.current.selectAndImportVideo('library'))
    expect(mediaEvents).toEqual(['capture-library-target', 'read-video-package'])
    mediaHook.unmount()

    const packageId = 'com.example.architecture-ratchet'
    const installedPackage = {
      manifest: { id: packageId, version: '1.0.0' },
    } as ComponentPackageData
    const catalogEntry: AvailableComponentCatalogPackage = {
      packageId,
      version: '2.0.0',
      name: 'Architecture ratchet fixture',
      description: 'Target capture order fixture',
      subject: [],
      schoolStage: [],
      tags: [],
      packagePath: 'fixture.h5component',
      thumbnailPath: 'fixture.png',
      sha256: 'a'.repeat(64),
      componentSchemaVersion: 4,
      runtimeApiVersion: 4,
      renderMode: 'dom',
      supportedScopes: ['scene'],
      quality: 'candidate',
      maintainer: 'test',
      verifiedCases: [],
      sourceId: 'fixture-source',
      sourceLabel: 'Fixture source',
      sourceTrust: 'trusted',
    }
    const componentEvents: string[] = []
    let componentPhase: 'manual' | 'catalog' = 'manual'
    const componentPorts: ComponentLibraryPorts = {
      captureIdentity: () => ({ projectId: 'project-1', revision: 1 }),
      captureReplacementTarget: () => {
        componentEvents.push(`capture-${componentPhase}-target`)
        return { projectId: 'project-1', documentRevision: 1, packageId }
      },
      readInstalledPackages: () => ({ [packageId]: installedPackage }),
      replacePackageAtTarget: () => ({ ok: true }),
      captureInsertionTarget: () => null,
      insertPackages: () => ({ ok: false }),
      selectComponentPackage: async () => {
        componentEvents.push('read-manual-package')
        return null
      },
      selectComponentPackages: async () => null,
      desktopAvailable: () => false,
      loadCatalog: async () => ({ sources: [], packages: [], issues: [] }),
      readCatalogPackage: async () => {
        componentEvents.push('read-catalog-package')
        throw new Error('fixture stops after proving capture order')
      },
      async runBusy<T>(operation: () => Promise<T>): Promise<T | undefined> {
        try {
          return await operation()
        } catch {
          return undefined
        }
      },
      commitStatus: () => undefined,
      reportError: () => undefined,
    }
    const componentHook = renderHook(() => useComponentLibrary(componentPorts))
    act(() => componentHook.result.current.replacePackage(packageId))
    await waitFor(() => expect(componentEvents).toContain('read-manual-package'))
    expect(componentEvents).toEqual(['capture-manual-target', 'read-manual-package'])

    componentEvents.length = 0
    componentPhase = 'catalog'
    act(() => componentHook.result.current.requestCatalogUpdate(catalogEntry))
    await waitFor(() => expect(componentHook.result.current.catalogUpdateRequest).not.toBeNull())
    act(() => componentHook.result.current.confirmCatalogUpdate())
    await waitFor(() => expect(componentEvents).toContain('read-catalog-package'))
    expect(componentEvents).toEqual(['capture-catalog-target', 'read-catalog-package'])
    componentHook.unmount()
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

    for (const [functionName, planner] of [
      ['commitRuntimeSourceAtTarget', 'planRuntimeSourceUpdate({'],
      ['updateRuntimeContentTextAtTarget', 'planRuntimeContentTextUpdate({'],
      ['updateRuntimePropertyAtTarget', 'planRuntimePropertyUpdate({'],
      ['createRuntimeTemplateAtTarget', 'planRuntimeTemplateCreation({'],
      ['replaceRuntimeAssetAtTarget', 'planCourseRuntimeAssetReplacement({'],
    ] as const) {
      const useCase = namedFunctionBody(runtimeCommit, functionName)
      expect(useCase, planner).toContain(planner)
      expect(useCase, functionName).toContain('createEditorTransactionStep(')
      expect(useCase, functionName).toContain('persistTransaction(')
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
    const readProjectionOwners = filesUnder('src').filter((path) => (
      containsIdentifier(source(path), readProjection)
    ))
    expect(readProjectionOwners).toEqual(['src/renderer/course/editorCanvasProjection.ts'])
    expect(exportedFunctionNames(source(readProjectionOwners[0]!))).toContain(readProjection)

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
    const applyTemplate = namedFunctionBody(interactions, 'applyInteractionTemplateAtTarget')
    expect(applyTemplate).toContain('planApplyInteractionTemplate({')
    expect(applyTemplate).toContain('persistInteractionAuthoringPlan(')
    const updateRule = namedFunctionBody(interactions, 'updateInteractionRuleAtTarget')
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
    expect(constructedControllerTargets(session)).toEqual([
      '#globalInteractionController',
      '#localInteractionController',
    ])
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
    expect(legacyEngineConsumers).toEqual([])
  })

  it('keeps global playback actions on canonical V9 Surface histories', () => {
    const runtime = source('src/renderer/runtime/commitRuntimeAuthoring.ts')
    const updatePlayback = namedFunctionBody(runtime, 'updatePlayback')
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
    expect(srcCorpus).not.toContain(['projectCandidatePreview', 'Document'].join(''))
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
    const factory = namedVariableInitializer(store, 'useEditorStore')
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
    const canvasProjection = source('src/renderer/course/editorCanvasProjection.ts')
    expect(canvasProjection).toContain("'无限画布'")
    expect(canvasProjection).toContain("'流式讲义'")
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
    expect(source('src/renderer/store/slices/courseLifecycleSlice.ts')).toContain('kernel: EditorStoreKernel')
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
    const retiredPainterSymbols = [
      ['Scene', 'Node'].join(''),
      ['Project', 'Document'].join(''),
      'schemaVersion',
      'writer',
      'session',
    ]
    expect(painter).not.toMatch(new RegExp(`\\b(?:${retiredPainterSymbols.join('|')})\\b`))
    const retiredPainterImports = [
      ['Player', 'Scene'].join(''),
      ['project', 'Types'].join(''),
      ['project', 'Schema'].join(''),
    ]
    expect(importSpecifiers(painter).filter((specifier) => (
      /editorStore|sceneAssets|renderNode|course-project-v9\/schema/.test(specifier)
      || retiredPainterImports.some((fragment) => specifier.includes(fragment))
    ))).toEqual([])
    const slideAdapter = source('src/player/surfaces/slide/SlidePublishedAdapter.ts')
    expect(slideAdapter).toContain("from './publishedNativeRendering'")
    expect(slideAdapter).toContain('readonlyNativeRenderInputFromPublishedItem')
    expect(importSpecifiers(slideAdapter).filter((specifier) => (
      /sceneAssets|renderNode|canvasShapeRenderer|imageEffects|publishedNativeText|publishedFormula/.test(specifier)
      || retiredPainterImports.some((fragment) => specifier.includes(fragment))
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

  it('keeps one Zustand store, V9 history depth, and fail-loud V8 load without migration code', () => {
    const zustandFiles = filesUnder('src').filter((path) => (
      /from ['"]zustand['"]/.test(source(path))
    ))
    expect(zustandFiles).toEqual(['src/renderer/store/editorStore.ts'])

    const srcFiles = filesUnder('src')
    const removedHistoryAdapter = ['v9HistoryToStore', 'History'].join('')
    expect(srcFiles.filter((path) => source(path).includes(removedHistoryAdapter))).toEqual([])
    const removedV8MigrationSymbol = ['migrateProjectV8', 'ToCourseProjectV9'].join('')
    expect(srcFiles.filter((path) => source(path).includes(removedV8MigrationSymbol))).toEqual([])
    expect(existsSync(join(root, ['tests/helpers/project', 'V8.ts'].join('')))).toBe(false)

    const kernel = source('src/renderer/store/editorStoreKernel.ts')
    expect(kernel).not.toContain('storeHistoryFromSessionLengths')
    expect(source('src/renderer/store/slices/slideAuthoringSlice.ts')).not.toContain('storeHistoryFromSessionLengths')
    expect(source('src/renderer/store/slices/flowAuthoringSlice.ts')).not.toContain('storeHistoryFromSessionLengths')
    expect(source('src/renderer/store/slices/spatialAuthoringSlice.ts')).not.toContain('storeHistoryFromSessionLengths')

    const lifecycle = source('src/renderer/store/slices/courseLifecycleSlice.ts')
    expect(lifecycle).toContain("throw new Error('V8 工程不能打开或导入。请使用 loadCourseProject 与 Course Project V9。')")
    expect(lifecycle).not.toMatch(new RegExp(`\\b${removedV8MigrationSymbol}\\(`))

    const consumers = editorStoreConsumers()
    expect(consumers.filter((path) => !isStoreCompositionAdapter(path))).toEqual([])
    expect(isStoreCompositionAdapter('src/renderer/runtime/forbiddenStoreConsumer.ts')).toBe(false)
  })

  it('clears the teacher-controller Store cycle and known runtime SCCs among Store owners', () => {
    expect(directedCycles(new Map([
      ['fixture/a.ts', ['fixture/b.ts']],
      ['fixture/b.ts', ['fixture/a.ts']],
    ]))).toEqual(['fixture/a.ts -> fixture/b.ts -> fixture/a.ts'])
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

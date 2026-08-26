import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import {
  BUNDLED_MATH_FONT_FAMILY,
  BUNDLED_TEXT_FONT_FAMILY,
} from '@/shared/fonts/bundledFontFamilies'
import {
  registerBundledFontEmbedPreparer,
  registerBundledFontEmbedSource,
  type EmbeddableBundledFont,
} from '@/renderer/export/bundledFontEmbedding'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createFormulaNode,
  createTextNode,
} from '@/renderer/project/createProject'
import { useEditorStore } from '@/renderer/store/editorStore'

vi.mock('@/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* Workspace preview font Player bundle */',
}))

vi.mock('@/renderer/phaser/createEditorGame', () => ({
  createEditorGame: () => {
    const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>()
    const bridge = new Proxy<Record<PropertyKey, unknown>>({}, {
      get: (_target, property) => {
        let method = methods.get(property)
        if (!method) {
          method = String(property).startsWith('on')
            ? () => () => undefined
            : () => undefined
          methods.set(property, method)
        }
        return method
      },
    })
    return {
      bridge,
      game: { scale: { refresh: () => undefined } },
      destroy: () => undefined,
    }
  },
}))

import { Workspace } from '@/renderer/ui/Workspace'

/**
 * Proves the runtime preview embeds the same bundled font bytes the canvas and
 * the export commands use, and that a project which declares none still gets
 * the byte-identical, single-tick document it got before fonts existed.
 *
 * Does not prove `@font-face` rendering (jsdom loads no fonts), export
 * products, or anything about the Player's own font loader.
 */
const NOW = '2026-08-26T00:00:00.000Z'
const NOTO_STACK = `"${BUNDLED_TEXT_FONT_FAMILY}", "Microsoft YaHei", sans-serif`
const PREVIEW_DOCUMENT_TYPE = 'text/html;charset=utf-8'
/** Distinguishable bytes; the real woff2 plumbing is proven elsewhere. */
const FACE_BYTES = Uint8Array.from([119, 79, 70, 50, 1, 2, 3, 4])

function fakeFont(family: string): EmbeddableBundledFont {
  return {
    family,
    style: 'normal',
    weight: '400',
    display: 'swap',
    license: {
      type: 'OFL-1.1',
      attribution: 'Test attribution',
      noticePath: 'vendor/fonts/test/LICENSE',
      packageName: 'test-font',
      packageVersion: '0.0.0',
    },
    licenseText: 'Test license text',
    faces: [{
      file: `${family.replaceAll(' ', '-')}.woff2`,
      specifier: `test/${family}.woff2`,
      bytes: FACE_BYTES,
    }],
  }
}

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

/** Every document Blob the preview handed to `URL.createObjectURL`. */
let previewDocuments: Blob[] = []
let prepareCalls = 0
let pendingPreparation: Deferred | null = null
/**
 * Whether the byte source can answer yet.
 *
 * The editor's real source is exactly this shape — installation touches nothing
 * and only `prepareBundledFontEmbedding()` fills its cache — so a builder that
 * skips the warm-up must resolve to no fonts here too.
 */
let bytesWarmed = false
/** Every session token the preview asked for, in the order it asked. */
let issuedTokens: string[] = []

function stableIds(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `id-${counter}`
  }
}

/**
 * A blank Slide lesson, optionally carrying the two declarations the export
 * path recognises: a formula node and a font stack naming a bundled family.
 */
function fixture(options: {
  formula?: boolean
  bundledTextFont?: boolean
} = {}): CourseProjectDocument {
  const idFactory = stableIds()
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
    idFactory,
  })
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('missing Slide surface')
  const scene = surface.scenes[0]
  if (!scene) throw new Error('missing Slide scene')
  if (options.bundledTextFont === true) {
    const node = createTextNode({ id: 'preview-font-text', x: 40, y: 40, idFactory })
    node.style.fontFamily = NOTO_STACK
    scene.layerItems.push(sceneNodeToCourseLayerItem(node, 100))
  }
  if (options.formula === true) {
    scene.layerItems.push(sceneNodeToCourseLayerItem(
      createFormulaNode({ id: 'preview-font-formula', x: 20, y: 20, idFactory }),
      200,
    ))
  }
  return courseProjectDocumentSchema.parse(project)
}

function loadFixture(options?: Parameters<typeof fixture>[0]): void {
  const project = fixture(options)
  useEditorStore.getState().loadCourseProject(project, null, {}, {})
  useEditorStore.getState().activateCourseLocation(project.startLocationId)
}

function renderWorkspace() {
  return render(
    <Workspace
      onAddImage={() => undefined}
      onAddVideo={() => undefined}
      onSelectImageAsset={() => Promise.resolve(null)}
    />,
  )
}

async function previewHtml(): Promise<string> {
  await screen.findByTitle('统一编辑画布')
  await waitFor(() => expect(previewDocuments).toHaveLength(1))
  return previewDocuments[0]!.text()
}

function faceBlocks(html: string): string[] {
  return [...html.matchAll(/@font-face \{[^}]*\}/g)].map((match) => match[0])
}

beforeEach(() => {
  previewDocuments = []
  prepareCalls = 0
  pendingPreparation = null
  bytesWarmed = false
  issuedTokens = []
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
    const token = `00000000-0000-4000-8000-00000000000${issuedTokens.length + 1}` as const
    issuedTokens.push(token)
    return token
  })
  vi.spyOn(URL, 'createObjectURL').mockImplementation((source) => {
    if (source instanceof Blob && source.type === PREVIEW_DOCUMENT_TYPE) {
      previewDocuments.push(source)
      return `blob:preview-document-${previewDocuments.length}`
    }
    return 'blob:preview-other'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  registerBundledFontEmbedPreparer(async () => {
    prepareCalls += 1
    if (pendingPreparation) await pendingPreparation.promise
    bytesWarmed = true
  })
  registerBundledFontEmbedSource(
    (families) => (bytesWarmed ? families.map(fakeFont) : []),
  )
})

afterEach(() => {
  cleanup()
  registerBundledFontEmbedPreparer(null)
  registerBundledFontEmbedSource(null)
  useEditorStore.getState().clearV9SlideCandidateBackend()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Workspace preview bundled fonts', () => {
  it('embeds the math face a formula lesson needs', async () => {
    loadFixture({ formula: true })
    renderWorkspace()

    const html = await previewHtml()
    expect(prepareCalls).toBe(1)
    expect(html).toContain('data:font/woff2;base64,')
    expect(faceBlocks(html)).toHaveLength(1)
    expect(faceBlocks(html)[0]).toContain(`font-family: '${BUNDLED_MATH_FONT_FAMILY}'`)
    // The same license notice the export products carry travels with the bytes.
    expect(html).toContain('Test license text')
  })

  it('embeds the text face a lesson that selects the bundled body font needs', async () => {
    loadFixture({ bundledTextFont: true })
    renderWorkspace()

    const html = await previewHtml()
    expect(prepareCalls).toBe(1)
    expect(faceBlocks(html)).toHaveLength(1)
    expect(faceBlocks(html)[0]).toContain(`font-family: '${BUNDLED_TEXT_FONT_FAMILY}'`)
  })

  it('embeds both faces when a lesson declares the body font and holds a formula', async () => {
    loadFixture({ formula: true, bundledTextFont: true })
    renderWorkspace()

    const html = await previewHtml()
    expect(faceBlocks(html)).toHaveLength(2)
    expect(faceBlocks(html)[0]).toContain(`font-family: '${BUNDLED_TEXT_FONT_FAMILY}'`)
    expect(faceBlocks(html)[1]).toContain(`font-family: '${BUNDLED_MATH_FONT_FAMILY}'`)
  })

  it('leaves a lesson that declares no bundled family byte-identical and synchronous', async () => {
    loadFixture()
    renderWorkspace()

    // Built inside the effect's own tick: the document Blob exists before any
    // microtask runs, which is what "no await was reached" looks like from here.
    expect(previewDocuments).toHaveLength(1)
    const html = await previewDocuments[0]!.text()
    // Never warmed, so no byte source can contribute and the build is the one
    // this path produced before it awaited anything.
    expect(prepareCalls).toBe(0)
    expect(html).not.toContain('@font-face')
    expect(html).not.toContain('data:font/')

    // Byte evidence: removing the byte source entirely — the state this path
    // was in before fonts existed — reproduces the same document exactly.
    previewDocuments = []
    cleanup()
    registerBundledFontEmbedSource(null)
    registerBundledFontEmbedPreparer(null)
    issuedTokens = []
    loadFixture()
    renderWorkspace()
    expect(previewDocuments).toHaveLength(1)
    expect(await previewDocuments[0]!.text()).toBe(html)
  })

  it('drops a run the cleanup retired while the font bytes were loading', async () => {
    pendingPreparation = deferred()
    loadFixture({ formula: true })
    const view = renderWorkspace()

    // Parked on the await: no document, so nothing to hand an iframe.
    expect(previewDocuments).toHaveLength(0)
    expect(screen.queryByTitle('统一编辑画布')).toBeNull()

    view.unmount()
    await act(async () => {
      pendingPreparation?.resolve()
      await pendingPreparation?.promise
    })

    // The retired run must not allocate a Blob URL nor commit a preview URL
    // onto an unmounted tree.
    expect(previewDocuments).toHaveLength(0)
    expect(screen.queryByTitle('统一编辑画布')).toBeNull()
  })

  it('lets only the newest run publish when a rebuild lands during the wait', async () => {
    pendingPreparation = deferred()
    loadFixture({ formula: true })
    renderWorkspace()
    expect(previewDocuments).toHaveLength(0)

    // Adding a node rebuilds the preview while the first run is still parked on
    // the font bytes.
    await act(async () => {
      useEditorStore.getState().addTextNode(120, 120)
    })
    expect(previewDocuments).toHaveLength(0)

    await act(async () => {
      pendingPreparation?.resolve()
      await pendingPreparation?.promise
    })

    // Exactly one document, and it belongs to the newer token: the superseded
    // run released its payload and committed nothing over its successor.
    await waitFor(() => expect(previewDocuments).toHaveLength(1))
    const frame = await screen.findByTitle('统一编辑画布') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe('blob:preview-document-1')
    expect(issuedTokens.length).toBeGreaterThanOrEqual(2)
    const html = await previewDocuments[0]!.text()
    expect(html).toContain(`data-token="${issuedTokens.at(-1)}"`)
    expect(html).not.toContain(`data-token="${issuedTokens[0]}"`)
    expect(html).toContain(`font-family: '${BUNDLED_MATH_FONT_FAMILY}'`)
  })
})

// @vitest-environment node
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSync } from 'esbuild'
import { parse, type Node } from 'acorn'
import { expect, it, vi } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureFlowMenuTarget, refreshFlowMenuTarget, releaseFlowMenuTarget, flowInsertionBoundaryBlockId, resolveFlowMenuInsertionOptions, insertFlowMenu as commitFlowMenu, type FlowInsertCommand } from '../../src/renderer/ui/flow/flowInsertCommands'
import { registerFlowMenuCapture } from '../../src/renderer/document/flowWorkspaceRegistry'
import { DocumentInsertionTargetError } from '../../src/shared/document/blockInsertion'
import { insertCourseMedia } from '../../src/renderer/media/commitCourseMediaAuthoring'

// Execute the real App entry callback with the real Kernel/Driver/Session.
// The transport queue is controlled so the user can switch tabs before work starts.
function appEntry(dependencies: Record<string, unknown>): (command: FlowInsertCommand) => void {
  const source = readFileSync(resolve('src/renderer/App.tsx'), 'utf8')
  const compiled = transformSync(source, { loader: 'tsx', format: 'esm', target: 'es2022' }).code
  const ast = parse(compiled, { ecmaVersion: 'latest', sourceType: 'module' })
  let expression: Node | undefined
  const visit = (node: Node) => {
    const declaration = node as Node & { id?: { name?: string }; init?: Node }
    if (node.type === 'VariableDeclarator' && declaration.id?.name === 'insertFlowMenu') expression = declaration.init
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) { if (child?.type) visit(child) }
      else if (value && typeof value === 'object' && 'type' in value) visit(value as Node)
    }
  }
  visit(ast)
  if (!expression) throw new Error('App Flow insertion entry is missing')
  return new Function(...Object.keys(dependencies), `return ${compiled.slice(expression.start, expression.end)}`)(...Object.values(dependencies))
}

it('CA-261 inserts into A when the actual App callback waits in the action queue and the user activates B', async () => {
  const project = createBlankCourseProjectV10('A'); testContainerInstance(project, 0).container.kind = 'flow'
  const h = await createV10StoreHost(project)
  await h.bridge.create({ kind: 'course-v10', project: { ...structuredClone(project), id: 'B', title: 'B' }, resources: { assets: {}, components: {} } })
  const other = h.bridge.read().snapshot!
  await h.bridge.activate(h.first.documentId)
  const unregister = registerFlowMenuCapture(() => {
    const target = h.kernel.captureTarget()
    return { ok: true, documentId: target.documentId, projectId: target.project.id, revision: target.project.revision,
      locationId: target.surfaceId!, surfaceId: target.surfaceId!, generation: 1, selectedBlockId: null,
      selectionSignature: '', paperWidth: 800, bodyWidth: 700, paragraphRects: [] }
  })
  try {
    const gate = deferred(); let tail: Promise<unknown> = gate.promise
    const setError = vi.fn()
    const insert = appEntry({ courseKernel: h.kernel, captureFlowMenuTarget, refreshFlowMenuTarget, releaseFlowMenuTarget, resolveFlowMenuInsertionOptions, commitFlowMenu,
      run: (work: () => Promise<unknown>) => { tail = tail.then(work).catch(setError); return tail },
      drainCourseDocument: async (id: string) => { const [snapshot] = await h.bridge.drain([id]); return snapshot },
      setError, setStatus: vi.fn(), readableError: (error: Error) => error.message,
      requestFlowBlockSelection: vi.fn(), requestFlowBlockFocus: vi.fn() })
    insert({ kind: 'heading', destination: 'document', label: '标题' })
    await h.bridge.activate(other.documentId)
    const beforeB = h.registry.get(other.documentId).read()
    gate.resolve(); await tail
    expect(setError).not.toHaveBeenCalled()
    expect(testContainerInstance(h.model().project, 0).childIds).toEqual([expect.any(String)])
    expect(h.registry.get(other.documentId).read()).toEqual(beforeB)
    expect(h.bridge.read().activeDocumentId).toBe(other.documentId)
  } finally { unregister(); h.bridge.dispose() }
})

it('retains prepared picker media and releases the invalid original target without submitting a write', async () => {
  const project = createBlankCourseProjectV10('原讲义'); testContainerInstance(project, 0).container.kind = 'flow'
  const h = await createV10StoreHost(project), release = vi.fn()
  let deleted = false
  const unregister = registerFlowMenuCapture(() => {
    const target = h.kernel.captureTarget()
    return { ok: true, documentId: target.documentId, projectId: project.id, revision: 0, locationId: target.surfaceId!, surfaceId: target.surfaceId!, generation: 1,
      selectedBlockId: null, selectionSignature: '', paperWidth: 800, bodyWidth: 700, paragraphRects: [],
      insertionSelection: { release, read() { if (deleted) throw new DocumentInsertionTargetError('原正文插入位置已失效'); return null } } }
  })
  try {
    const selected = { meta: { id: 'prepared', path: 'assets/prepared.png', filename: 'prepared.png', kind: 'image', mimeType: 'image/png', width: 20, height: 20, byteLength: 3 }, bytes: Uint8Array.of(1, 2, 3) }
    const setPendingFlowComponent = vi.fn(), setError = vi.fn()
    let tail: Promise<unknown> = Promise.resolve()
    const insert = appEntry({ courseKernel: h.kernel, captureFlowMenuTarget, refreshFlowMenuTarget, releaseFlowMenuTarget, flowInsertionBoundaryBlockId,
      resolveFlowMenuInsertionOptions, commitFlowMenu, insertCourseMedia, DocumentInsertionTargetError,
      mediaImport: { selectImageAsset: async () => { deleted = true; return selected } },
      run: (work: () => Promise<unknown>) => { tail = tail.then(work).catch(setError); return tail },
      setPendingFlowComponent, setError, setStatus: vi.fn(), readableError: (error: Error) => error.message })
    insert({ kind: 'image', destination: 'document', label: '图片' }); await tail
    expect(setPendingFlowComponent).toHaveBeenCalledWith(expect.objectContaining({ media: selected, reason: '原正文插入位置已失效', afterBlockId: null }))
    expect(release).toHaveBeenCalledTimes(1)
    expect(h.operations).toHaveLength(0)
  } finally { unregister(); h.bridge.dispose() }
})

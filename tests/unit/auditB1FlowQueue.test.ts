// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSync } from 'esbuild'
import { parse, type Node } from 'acorn'
import { expect, it, vi } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureFlowMenuTarget, resolveFlowMenuInsertionOptions, insertFlowMenu as commitFlowMenu, type FlowInsertCommand } from '../../src/renderer/ui/flow/flowInsertCommands'
import { registerFlowMenuCapture } from '../../src/renderer/document/flowWorkspaceRegistry'

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
  const project = createBlankCourseProjectV10('A'); project.surfaces[0].kind = 'flow'
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
    const insert = appEntry({ courseKernel: h.kernel, captureFlowMenuTarget, resolveFlowMenuInsertionOptions, commitFlowMenu,
      run: (work: () => Promise<unknown>) => { tail = tail.then(work).catch(setError); return tail },
      drainCourseDocument: async (id: string) => { const [snapshot] = await h.bridge.drain([id]); return snapshot },
      setError, setStatus: vi.fn(), readableError: (error: Error) => error.message,
      requestFlowBlockSelection: vi.fn(), requestFlowBlockFocus: vi.fn() })
    insert({ kind: 'heading', destination: 'document', label: '标题' })
    await h.bridge.activate(other.documentId)
    const beforeB = h.registry.get(other.documentId).read()
    gate.resolve(); await tail
    expect(setError).not.toHaveBeenCalled()
    expect(h.first.read().model).toMatchObject({ project: { surfaces: [{ childIds: [expect.any(String)] }] } })
    expect(h.registry.get(other.documentId).read()).toEqual(beforeB)
    expect(h.bridge.read().activeDocumentId).toBe(other.documentId)
  } finally { unregister(); h.bridge.dispose() }
})

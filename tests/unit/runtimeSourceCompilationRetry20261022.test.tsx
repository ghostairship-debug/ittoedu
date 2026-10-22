import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import type { ComponentCompilationInput } from '../../src/core/components/compilation/types'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

vi.mock('../../src/renderer/components/SandboxComponentImplementation', () => ({
  prepareSandboxComponent: async () => ({ artifactIdentity: 'retry-module', implementation: { mount() { return { update() {}, dispose() {} } } } }),
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('retries the same source input after a normally returned compile failure, keeping successful preparation shared', async () => {
  let attempts = 0
  const compileComponent = vi.fn(async (input: ComponentCompilationInput) => ++attempts === 1
    ? { status: 'failed' as const, source: input, cacheHit: false, durationMs: 1,
      diagnostics: [{ stage: 'compile' as const, severity: 'error' as const, message: 'temporary compiler failure' }] }
    : { status: 'ready' as const, source: input, cacheHit: false, durationMs: 1,
      artifact: { format: 'esm' as const, code: 'export default {}', css: '', diagnostics: [] } })
  vi.stubGlobal('desktopAPI', { compileComponent })
  const project: CourseProjectV10 = { schemaVersion: 11, id: 'compile-retry', title: 'Retry', revision: 0,
    rootIds: ['probe'], entry: { rootInstanceId: 'probe' }, global: { underlay: [], overlay: [] }, assets: {},
    definitions: { source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } },
    instances: { probe: { id: 'probe', definitionId: 'source', data: {} } } }
  const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
  let ports!: CourseV10RuntimePorts
  const ui = render(<CourseV10RuntimeView documentId="compile-retry" model={model} surfaceId={null}
    selectedInstanceId={null} player={false} onSelect={() => {}} onSurfaceSelect={() => {}} report={() => {}}
    renderWorkspace={value => { ports = value; return value.renderInstance('probe') }} />)
  try {
    await waitFor(() => expect(ports.world.host.capabilities(ports.world.runScopeId, 'probe').status).toBe('failed'))
    await act(async () => { await ports.world.sync(project, model.resources) })
    expect(ports.world.host.capabilities(ports.world.runScopeId, 'probe').status).toBe('ready')
    expect(compileComponent).toHaveBeenCalledTimes(2)
    expect(compileComponent.mock.calls[1]![0]).toBe(compileComponent.mock.calls[0]![0])
  } finally { ui.unmount() }
})

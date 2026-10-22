// @vitest-environment node
import { expect, it } from 'vitest'
import { builtInWorkAsset } from '../../src/core/components/library/workAssets'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'

it('compiles the professional source variant with the existing shape algorithm and public data contract', async () => {
  await loadBuiltinComponentSource('guoling.shape')
  const asset = builtInWorkAsset('guoling.work.professional.shape-source')!
  const project: CourseProjectV11 = { schemaVersion: 11, id: asset.id, title: asset.title, revision: 0,
    definitions: asset.definitions, instances: asset.example.instances, assets: asset.assets,
    rootIds: asset.example.rootIds, entry: { rootInstanceId: asset.example.rootIds[0]! }, global: { underlay: [], overlay: [] } }
  const variant = asset.definitions[asset.example.instances[asset.example.rootIds[0]].definitionId]
  expect(variant.professionalBuiltinKey).toBe('guoling.shape')
  if (variant.implementation.kind !== 'source') throw new Error('expected source variant')
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const result = await compilation.compile(componentCompilationInput(project, variant.implementation, asset.resources))
  expect(result.status, result.status === 'failed' ? JSON.stringify(result.diagnostics) : undefined).toBe('ready')
})

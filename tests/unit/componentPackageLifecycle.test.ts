import { describe, expect, it } from 'vitest'
import {
  collectComponentPackageUsage,
  collectComponentPackageUsages,
  evaluateComponentPackageDeletion,
  planComponentPackageReplacement,
  rollbackComponentPackageReplacement,
} from '../../src/shared/componentPackageLifecycle'
import type {
  EmbeddedComponentPackageMeta,
  ProjectDocument,
  SceneDocument,
} from '../../src/shared/projectTypes'
import { createDefaultScenePresentation } from '../../src/shared/presentation'
import { createExternalComponentNode } from '../../src/renderer/project/nativeNodeFactories'

const PACKAGE_ID = 'com.example.lesson-widget'

function packageMeta(
  version: string,
  packageId = PACKAGE_ID,
): EmbeddedComponentPackageMeta {
  return {
    packageId,
    version,
    name: `Widget ${version}`,
    manifestPath: `components/${packageId}@${version}/manifest.json`,
    runtimePath: `components/${packageId}@${version}/runtime.js`,
    thumbnailPath: `components/${packageId}@${version}/thumbnail.png`,
    contentSha256: '0'.repeat(64),
  }
}

function fixture() {
  const sceneNode = createExternalComponentNode({
    id: 'scene-component',
    name: '场景组件',
    component: { packageId: PACKAGE_ID, version: '1.0.0' },
    props: { content: { title: '保留文案' }, answer: 2 },
  })
  const scene1: SceneDocument = {
    id: 'scene_1',
    name: '场景 1',
    backgroundColor: '#ffffff',
    backgroundAssetId: null,
    nodes: [sceneNode],
    presentation: {
      initialStateId: 'state_initial',
      states: [
        { id: 'state_initial', name: '初始', nodeOverrides: {} },
        {
          id: 'state-hidden',
          name: '隐藏状态',
          nodeOverrides: {
            [sceneNode.id]: { visible: false },
          },
        },
      ],
    },
    interactions: [],
  }
  const scene2: SceneDocument = {
    id: 'scene-2',
    name: '场景 2',
    backgroundColor: '#ffffff',
    backgroundAssetId: null,
    nodes: [],
    presentation: createDefaultScenePresentation(),
    interactions: [],
  }
  const globalNode = createExternalComponentNode({
    id: 'global-component',
    name: '全局组件',
    component: { packageId: PACKAGE_ID, version: '1.0.0' },
    props: { theme: 'dark' },
  })
  return {
    scenes: [scene1, scene2],
    globalLayer: [{
      node: globalNode,
      layer: 'overlay' as const,
      visibility: { mode: 'include' as const, sceneIds: ['scene-2'] },
    }],
    componentPackages: {
      [`${PACKAGE_ID}@1.0.0`]: packageMeta('1.0.0'),
    },
  } as unknown as ProjectDocument
}

describe('组件包使用与生命周期规划', () => {
  it('统计场景、命名状态和全局实例，并保留显隐语义', () => {
    const project = fixture()
    const usage = collectComponentPackageUsage(project, PACKAGE_ID)

    expect(usage).toMatchObject({
      packageId: PACKAGE_ID,
      packageKeys: [`${PACKAGE_ID}@1.0.0`],
      declaredVersions: ['1.0.0'],
      sceneInstanceCount: 1,
      stateReferenceCount: 2,
      visibleStateCount: 1,
      globalInstanceCount: 1,
      totalInstanceCount: 2,
    })
    expect(usage.references.find((item) => item.scope === 'scene')?.states).toEqual([
      { stateId: expect.any(String), stateName: '初始', visible: true },
      { stateId: 'state-hidden', stateName: '隐藏状态', visible: false },
    ])
    expect(usage.references.find((item) => item.scope === 'global')?.visibleSceneIds)
      .toEqual(['scene-2'])
    expect(collectComponentPackageUsages(project)).toHaveLength(1)
  })

  it('仅允许删除没有任何场景或全局实例引用的组件包', () => {
    const project = fixture()
    expect(evaluateComponentPackageDeletion(project, PACKAGE_ID)).toMatchObject({
      packageExists: true,
      canDelete: false,
      reason: 'referenced',
    })

    project.scenes[0]!.nodes = []
    project.globalLayer = []
    expect(evaluateComponentPackageDeletion(project, PACKAGE_ID)).toMatchObject({
      packageExists: true,
      canDelete: true,
      reason: 'unused',
    })
    expect(evaluateComponentPackageDeletion(project, 'com.example.missing')).toMatchObject({
      packageExists: false,
      canDelete: false,
      reason: 'package-missing',
    })
  })

  it('同 ID 替换会更新全部实例版本、保留 props，并可用细粒度快照回滚', () => {
    const original = fixture()
    const originalSnapshot = structuredClone(original)
    const replacement = packageMeta('2.0.0')
    const plan = planComponentPackageReplacement(original, replacement)

    expect(original).toEqual(originalSnapshot)
    expect(plan.replacementKey).toBe(`${PACKAGE_ID}@2.0.0`)
    expect(plan.previousVersions).toEqual(['1.0.0'])
    expect(plan.affectedInstances).toHaveLength(2)
    expect(plan.nextProject.componentPackages).toEqual({
      [`${PACKAGE_ID}@2.0.0`]: replacement,
    })
    expect(plan.nextProject.scenes[0]!.nodes[0]).toMatchObject({
      component: { packageId: PACKAGE_ID, version: '2.0.0' },
      props: { content: { title: '保留文案' }, answer: 2 },
    })
    expect(plan.nextProject.globalLayer[0]!.node).toMatchObject({
      component: { packageId: PACKAGE_ID, version: '2.0.0' },
      props: { theme: 'dark' },
    })

    const rolledBack = rollbackComponentPackageReplacement(
      plan.nextProject,
      plan.rollback,
    )
    expect(rolledBack).toEqual(originalSnapshot)
  })

  it('拒绝替换不存在的包或覆盖其他组件占用的记录键', () => {
    const project = fixture()
    expect(() => planComponentPackageReplacement(
      project,
      packageMeta('1.0.0', 'com.example.missing'),
    )).toThrow('不存在可替换')

    project.componentPackages.occupied = packageMeta('5.0.0', 'com.example.other')
    expect(() => planComponentPackageReplacement(
      project,
      packageMeta('2.0.0'),
      { replacementKey: 'occupied' },
    )).toThrow('已被')
  })
})

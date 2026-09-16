import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { ComponentPackageData, EmbeddedComponentPackageMeta } from '../../shared/contracts/component-v4'
import type { CourseProjectDocument, FlowBlock } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/document/resources'
import { documentResourcesSchema } from '../../shared/document/resources'
import type { DocumentClipboardResourcePort } from './documentClipboard'
import { replaceFlowDocumentContent, type FlowCommandResult } from '../course/flowEditorCommands'
import { createEditorTransactionStep, type EditorTransactionStep } from '../authoring/editorTransaction'
import type { HistoryResourceChanges } from '../store/courseResourceState'

type AssetReference = DocumentResources['assets'][number]
type ComponentReference = DocumentResources['components'][number]
export type FlowDocumentResourceTarget = Pick<CourseProjectDocument, 'id' | 'revision' | 'assets' | 'componentPackages'>
export type ResolvedDocumentAsset = { meta: AssetMeta; bytes: Uint8Array }
export interface FlowPreparedDocumentResources {
  readonly projectId: string
  readonly baseRevision: number
  readonly assets: Record<string, AssetMeta>
  readonly componentPackages: Record<string, EmbeddedComponentPackageMeta>
  readonly resourceChanges: HistoryResourceChanges
}
const staged = new WeakSet<object>()
const extension = (filename: string) => /\.([a-z0-9]{1,12})$/i.exec(filename)?.[1]?.toLowerCase() ?? 'bin'

/** Source ownership is captured by the resolver, never inferred from an asset ID. */
export function createFlowDocumentResourcePort(input: {
  target: FlowDocumentResourceTarget
  resolveAsset(ref: AssetReference): Promise<ResolvedDocumentAsset>
  prepareComponent(ref: ComponentReference, target: FlowDocumentResourceTarget): Promise<{ meta: EmbeddedComponentPackageMeta; data: ComponentPackageData }>
  createId?: () => string
}): DocumentClipboardResourcePort<FlowPreparedDocumentResources> {
  const target = structuredClone(input.target)
  return {
    async prepareResources({ resources }) {
      documentResourcesSchema.parse(resources)
      const prepared: FlowPreparedDocumentResources = { projectId: target.id, baseRevision: target.revision, assets: {}, componentPackages: {}, resourceChanges: { assetFileChanges: [], componentPackageChanges: [] } }
      const mapped: DocumentResources = { assets: [], components: [] }
      const assetIds: Record<string, string> = {}
      const components: { from: { packageId: string; version: string }; to: { packageId: string; version: string } }[] = []
      for (const ref of resources.assets) {
        const resolved = await input.resolveAsset(ref)
        const id = (input.createId ?? (() => crypto.randomUUID()))()
        if (target.assets[id] || prepared.assets[id]) throw new Error('素材身份生成冲突')
        const bytes = resolved.bytes.slice()
        if (!bytes.byteLength) throw new Error('复制的素材为空')
        prepared.assets[id] = { ...resolved.meta, id, path: `assets/${id}.${extension(resolved.meta.filename)}`, byteLength: bytes.byteLength }
        prepared.resourceChanges.assetFileChanges!.push({ assetId: id, after: bytes })
        assetIds[ref.assetId] = id
        mapped.assets.push({ assetId: id, source: { kind: 'project' } })
      }
      for (const ref of resources.components) {
        const resolved = await input.prepareComponent(ref, target)
        const id = resolved.meta.packageId
        if (target.componentPackages[id] && target.componentPackages[id]!.contentSha256 !== resolved.meta.contentSha256) throw new Error('组件包身份冲突，须由包 Owner 准备独立副本')
        if (resolved.meta.version !== resolved.data.manifest.version || id !== resolved.data.manifest.id) throw new Error('组件包准备结果身份不一致')
        if (!target.componentPackages[id]) {
          prepared.componentPackages[id] = structuredClone(resolved.meta)
          prepared.resourceChanges.componentPackageChanges!.push({ packageId: id, after: structuredClone(resolved.data) })
        }
        components.push({ from: { packageId: ref.packageId, version: ref.version }, to: { packageId: id, version: resolved.meta.version } })
        mapped.components.push({ packageId: id, version: resolved.meta.version, source: { kind: 'project' } })
      }
      staged.add(prepared)
      return { resources: mapped, assetIds, components, prepared }
    },
    async discard(prepared) { staged.delete(prepared) },
  }
}

/** Produces one existing canonical transaction; no project, sidecar, or History writes. */
export function prepareFlowDocumentResourceTransaction(document: CourseProjectDocument, surfaceId: string, blocks: FlowBlock[], prepared: unknown): { result: FlowCommandResult; step: EditorTransactionStep | null } {
  const fail = (reason: string) => ({ result: { ok: false, historyEntry: false, reason } as FlowCommandResult, step: null })
  if (!prepared || typeof prepared !== 'object' || !staged.has(prepared)) return fail('正文资源准备已失效')
  const resources = prepared as FlowPreparedDocumentResources
  if (resources.projectId !== document.id || resources.baseRevision !== document.revision) return fail('正文资源目标已变化，请重新粘贴')
  const candidate = { ...document, assets: { ...document.assets, ...resources.assets }, componentPackages: { ...document.componentPackages, ...resources.componentPackages } }
  const result = replaceFlowDocumentContent(candidate, surfaceId, blocks, { expectedRevision: document.revision })
  if (!result.ok || !result.nextDocument) return { result, step: null }
  const step = createEditorTransactionStep(document, { projectId: document.id, baseRevision: document.revision, nextDocument: result.nextDocument, resourceChanges: resources.resourceChanges })
  return { result, step }
}


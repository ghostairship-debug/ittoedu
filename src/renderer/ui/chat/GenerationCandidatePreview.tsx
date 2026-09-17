import { useEffect, useMemo, useRef, useState } from 'react'
import type { GenerationRequest } from '../../../shared/generationContract'
import type { createGenerationCandidateCoordinator } from '../../authoring/generation/prepareGenerationCandidate'
import { attachPublishedCourseStageFit, fitPublishedCourseStage, mountPublishedCourseTryRun } from '../coursePlayerTryRun'
import { beginSerializedSessionMount, createSerialAsyncChain } from '../serializedSessionMount'
import './generation-candidate-preview.css'

// Derived from the preparation Owner; this component owns no candidate state or commit port.
type GenerationPrepared = Awaited<ReturnType<ReturnType<typeof createGenerationCandidateCoordinator>['prepare']>>
export interface GenerationCandidatePreviewProps { prepared: GenerationPrepared; request: GenerationRequest }

const changeKindLabel = { created: '新建', deleted: '删除', updated: '修改', reordered: '换序' } as const
const evidenceStatusLabel = { checked: '已检查', skipped: '已跳过', failed: '检查失败' } as const
const positionLabel = (position: { locationId: string | null; stateId: string | null }) =>
  `${position.locationId ?? '无位置'}${position.stateId ? ` / 状态 ${position.stateId}` : ''}`

export function GenerationCandidatePreview({ prepared, request }: GenerationCandidatePreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chain = useRef(createSerialAsyncChain())
  const [status, setStatus] = useState<'preparing' | 'ready' | 'failed'>('preparing')
  const [error, setError] = useState('')
  const [beforeImageFailed, setBeforeImageFailed] = useState(false)
  const sourceFrame = request.observation?.files.find(file => file.fileId === 'current-frame' && file.role === 'image')
  const beforeImage = useMemo(() => {
    if (!sourceFrame) return null
    const resource = request.resourceFiles?.find(file => file.path === sourceFrame.relativePath)
    return resource?.encoding === 'base64' && resource.mediaType === 'image/png'
      ? `data:image/png;base64,${resource.content}` : null
  }, [sourceFrame, request.resourceFiles])
  useEffect(() => { setBeforeImageFailed(false) }, [beforeImage])
  const observedLocation = request.observation?.locationId
  const locationId = prepared.document.locations.some(location => location.id === observedLocation)
    ? observedLocation! : prepared.document.startLocationId
  const location = prepared.document.locations.find(item => item.id === locationId)
  const surface = prepared.document.surfaces.find(item => item.id === location?.surfaceId)
  const stateId = request.observation?.stateId
  const initialPresentationStateId = surface?.type === 'slide' && location?.kind === 'slide-scene'
    && surface.scenes.find(scene => scene.id === location.sceneId)?.presentation?.states.some(state => state.id === stateId)
    ? stateId : null
  const semanticChanges = prepared.semanticChanges
  const executionEvidence = prepared.interactionChecks?.evidence ?? []
  const incompleteScopes = semanticChanges.comparison.scopes.filter(scope => scope.status !== 'complete')

  useEffect(() => {
    const container = hostRef.current
    if (!container) return
    setStatus('preparing'); setError('')
    container.dataset.candidateReady = 'false'
    return beginSerializedSessionMount(chain.current, async () => {
      const session = await mountPublishedCourseTryRun({ container, project: prepared.document,
        assetFiles: prepared.resources.assetFiles, components: prepared.resources.componentPackages,
        locationId, initialPresentationStateId, observation: false })
      let detachFit = () => {}, detachNavigation = () => {}
      try {
        detachFit = attachPublishedCourseStageFit(container)
        detachNavigation = session.subscribeNavigation(() => fitPublishedCourseStage(container))
      } catch (reason) { detachFit(); detachNavigation(); await session.destroy(); throw reason }
      return { async destroy() { detachFit(); detachNavigation(); await session.destroy() } }
    }, {
      onReady() { container.dataset.candidateReady = 'true'; setStatus('ready') },
      onError(reason) { setStatus('failed'); setError(reason instanceof Error ? reason.message : String(reason)) },
      onCleanup() { container.dataset.candidateReady = 'false' },
    })
  }, [prepared.previewId, prepared.document, prepared.resources.assetFiles, prepared.resources.componentPackages,
    locationId, initialPresentationStateId])

  return <section className="generation-candidate-preview" aria-label="修改效果预览">
    <figure className="generation-candidate-preview__before">
      <figcaption>修改前 · 发送时的画面</figcaption>
      {beforeImage && !beforeImageFailed
        ? <img src={beforeImage} alt="发送请求时的课件画面" onError={() => setBeforeImageFailed(true)} />
        : <p className="generation-candidate-preview__missing">本轮没有可显示的修改前画面。</p>}
    </figure>
    <figure className="generation-candidate-preview__after">
      <figcaption>候选效果 <span>可以点击、操作和翻页</span></figcaption>
      <div className="generation-candidate-preview__viewport">
        <div ref={hostRef} className="generation-candidate-preview__host" data-testid="generation-candidate-player" />
        {status === 'preparing' && <p className="generation-candidate-preview__feedback" role="status">正在准备效果预览…</p>}
        {status === 'failed' && <p className="generation-candidate-preview__feedback generation-candidate-preview__error" role="alert">预览未能完成：{error}</p>}
      </div>
    </figure>
    <section className="generation-candidate-preview__facts" aria-label="候选实际变更">
      <h4>实际变更</h4>
      <p className="generation-candidate-preview__fact-summary">
        {semanticChanges.changes.length
          ? `摘要列出 ${semanticChanges.changes.length} 项实际差异。`
          : semanticChanges.comparison.status === 'complete'
            ? '完整比较范围内没有实际差异。'
            : '已比较范围内没有实际差异；仍有范围未完成比较。'}
      </p>
      {incompleteScopes.length > 0 && <p className="generation-candidate-preview__scope-note">
        比较范围不完整：{incompleteScopes.map(scope => `${scope.scope}（${scope.status}${scope.reason ? `：${scope.reason}` : ''}）`).join('；')}。
      </p>}
      {semanticChanges.changes.length > 0 && <details>
        <summary>查看差异明细（{semanticChanges.changes.length} 项）</summary>
        <ol className="generation-candidate-preview__changes">
          {semanticChanges.changes.map((change, index) => <li key={`${change.path}:${change.kind}:${index}`}>
            <div className="generation-candidate-preview__change-heading">
              <span className={`generation-candidate-preview__change-kind is-${change.kind}`}>{changeKindLabel[change.kind]}</span>
              <strong>{change.target?.name ?? change.target?.id ?? change.field ?? change.path}</strong>
              {change.target && <span>{change.target.ownerKey} · {change.target.impact === 'shared' ? '共享影响' : '实例影响'}</span>}
            </div>
            <code>{change.path}</code>
            {(change.target?.locationId || change.target?.stateId) && <p>
              位置 {change.target.locationId ?? '未指定'}{change.target.stateId ? ` / 状态 ${change.target.stateId}` : ''}
            </p>}
            <dl>
              <div><dt>修改前</dt><dd>{change.before}</dd></div>
              <div><dt>修改后</dt><dd>{change.after}</dd></div>
            </dl>
            {change.truncated && <p className="generation-candidate-preview__truncation">显示值已截断；此处不是完整字段内容。</p>}
          </li>)}
        </ol>
      </details>}
      {semanticChanges.omitted > 0 && <p className="generation-candidate-preview__truncation" role="status">
        摘要达到 {semanticChanges.truncation.changeLimit} 项上限，另有 {semanticChanges.omitted} 项未列出；当前结果不包含这些条目的完整详情。
      </p>}
    </section>
    <section className="generation-candidate-preview__facts" aria-label="候选行为检查记录">
      <h4>行为检查记录</h4>
      {executionEvidence.length === 0
        ? <p className="generation-candidate-preview__fact-summary">本轮没有 Player 行为检查记录。</p>
        : <ul className="generation-candidate-preview__evidence">
          {executionEvidence.map(evidence => <li key={`${evidence.ruleId}:${evidence.runId}:${evidence.chainId}`}>
            <div><span className={`generation-candidate-preview__evidence-status is-${evidence.status}`}>{evidenceStatusLabel[evidence.status]}</span>
              <strong>规则 {evidence.ruleId}</strong></div>
            <p>{positionLabel(evidence.start)} → {positionLabel(evidence.end)}</p>
            <p>来源 Published Player · 运行终态 {evidence.runStatus}{evidence.reason ? ` · ${evidence.reason}` : ''}</p>
          </li>)}
        </ul>}
      <p className="generation-candidate-preview__evidence-boundary">这些记录描述规则运行与观察范围，不代表教学目标已经通过。</p>
    </section>
  </section>
}

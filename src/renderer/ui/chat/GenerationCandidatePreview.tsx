import { useEffect, useMemo, useRef, useState } from 'react'
import type { GenerationRequest } from '../../../shared/generationContract'
import type { createGenerationCandidateCoordinator } from '../../authoring/generation/prepareGenerationCandidate'
import { attachPublishedCourseStageFit, fitPublishedCourseStage, mountPublishedCourseTryRun } from '../coursePlayerTryRun'
import { beginSerializedSessionMount, createSerialAsyncChain } from '../serializedSessionMount'
import './generation-candidate-preview.css'

// Derived from the preparation Owner; this component owns no candidate state or commit port.
type GenerationPrepared = Awaited<ReturnType<ReturnType<typeof createGenerationCandidateCoordinator>['prepare']>>
export interface GenerationCandidatePreviewProps { prepared: GenerationPrepared; request: GenerationRequest }

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
  </section>
}

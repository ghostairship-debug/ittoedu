import { dynamicAdmissionPayloadSchema, type DynamicInstanceCapture } from '../../../shared/dynamicAdmissionContract'
import { parseComponentPackageFiles } from '../../../core/drivers/codecs/importComponentPackage'
import { runDynamicCandidateHostSmoke } from '../tools/dynamicCandidateAdmission'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { ensureBundledFonts } from '../../../shared/fonts/ensureBundledFonts'
import { AuthoringToolFailure } from '../tools/executeAuthoringTool'
import { dynamicBehaviorFrameSchema, type DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'

const frameSchema = dynamicBehaviorFrameSchema.pick({ dataUrl: true, capturedAt: true, width: true, height: true })
let frameSequence = 0
let completedTargets = 0
Object.defineProperty(window, '__COURSEWARE_ADMISSION_PROGRESS__', { writable: false, value: () => completedTargets })
let pendingFrame: { id: number; resolve(frame: ReturnType<typeof frameSchema.parse>): void } | null = null
let pendingButton: { id: number; x: number; y: number; resolve(): void } | null = null
Object.defineProperty(window, '__COURSEWARE_ADMISSION_PENDING_BUTTON__', { writable: false, value: () => pendingButton ? { id: pendingButton.id, x: pendingButton.x, y: pendingButton.y } : null })
Object.defineProperty(window, '__COURSEWARE_ADMISSION_ACCEPT_BUTTON__', { writable: false, value: (id: number) => {
  if (!pendingButton || pendingButton.id !== id) throw new Error('动态按钮输入已失效')
  const pending = pendingButton; pendingButton = null; pending.resolve()
} })
Object.defineProperty(window, '__COURSEWARE_ADMISSION_PENDING_FRAME__', { writable: false, value: () => pendingFrame ? { id: pendingFrame.id } : null })
Object.defineProperty(window, '__COURSEWARE_ADMISSION_ACCEPT_FRAME__', { writable: false, value: (id: number, raw: unknown) => {
  if (!pendingFrame || pendingFrame.id !== id) throw new Error('动态观察帧已失效')
  const frame = frameSchema.parse(raw), pending = pendingFrame
  pendingFrame = null
  pending.resolve(frame)
} })

const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))
Object.defineProperty(window, '__COURSEWARE_ADMISSION_RUN__', { configurable: false, writable: false,
  value: async (raw: unknown) => {
    const behaviorEvidence: DynamicBehaviorObservation[] = []
    try {
      const input = dynamicAdmissionPayloadSchema.parse(raw)
      installBundledFontFaces()
      await ensureBundledFonts()
      completedTargets = 0
      const assetFiles = Object.fromEntries(Object.entries(input.assetFiles).map(([id, value]) => [id, typeof value === 'string' ? decode(value) : value]))
      const componentPackages = Object.fromEntries(Object.entries(input.componentFiles).map(([id, files]) => [id,
        parseComponentPackageFiles(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, decode(value)])))]))
      const failures: string[] = []
      const bodyChildren = new Set(document.body.children)
      const onError = (event: ErrorEvent) => { failures.push(String(event.error ?? event.message)); event.preventDefault() }
      const onRejection = (event: PromiseRejectionEvent) => { failures.push(String(event.reason)); event.preventDefault() }
      window.addEventListener('error', onError)
      window.addEventListener('unhandledrejection', onRejection)
      let captures: readonly DynamicInstanceCapture[] = []
      try {
        captures = await runDynamicCandidateHostSmoke(input.project, { assetFiles, componentPackages }, input.targets, input.captureInstances, {
          assetResources: input.assetResources, onTargetComplete: () => { completedTargets++ },
          verificationMode: input.verificationMode, onBehaviorEvidence: evidence => behaviorEvidence.push(...evidence),
          ...(input.buttonCheck ? { buttonCheck: input.buttonCheck } : {}),
          ...(input.observeBehavior ? { capturePort: { captureFrame: () => new Promise<ReturnType<typeof frameSchema.parse>>(resolve => {
            if (pendingFrame) throw new Error('动态观察帧请求不能重叠')
            pendingFrame = { id: ++frameSequence, resolve }
          }), ...(input.buttonCheck ? { clickAt: ({ x, y }: { x: number; y: number }) => new Promise<void>(resolve => {
            if (pendingButton || pendingFrame) throw new Error('动态按钮输入不能与捕获重叠')
            pendingButton = { id: ++frameSequence, x, y, resolve }
          }) } : {}) } } : {}),
        })
        // Drain callbacks already queued by teardown before declaring success.
        await new Promise(resolve => setTimeout(resolve, 0))
        if ([...document.body.children].some(child => !bodyChildren.has(child))) failures.push('动态候选销毁后留下宿主外 DOM')
        if (failures.length) throw new AuthoringToolFailure([{ code: 'dynamic-host-failed', message: failures.join('; ').slice(0, 4000), path: [] }])
      } finally {
        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
      }
      return { ok: true, message: input.verificationMode === 'public-props' ? '受影响公开参数已在真实宿主更新并观察' : '独立进程中的真实宿主准入通过', ...(input.captureInstances ? { captures } : {}), ...(behaviorEvidence.length ? { behaviorEvidence } : {}) }
    } catch (error) {
      const evidence = error instanceof AuthoringToolFailure && error.behaviorEvidence?.length ? error.behaviorEvidence : behaviorEvidence
      return { ok: false, message: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
        ...(error instanceof AuthoringToolFailure ? { diagnostics: error.diagnostics } : {}), ...(evidence.length ? { behaviorEvidence: evidence } : {}) }
    } finally { pendingFrame = null; pendingButton = null }
  },
})

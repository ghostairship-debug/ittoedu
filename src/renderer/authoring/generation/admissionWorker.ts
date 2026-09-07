import { dynamicAdmissionPayloadSchema, type DynamicInstanceCapture } from '../../../shared/dynamicAdmissionContract'
import { parseComponentPackageFiles } from '../../components/importComponentPackage'
import { runDynamicCandidateHostSmoke } from '../tools/dynamicCandidateAdmission'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { ensureBundledFonts } from '../../../shared/fonts/ensureBundledFonts'
import { AuthoringToolFailure } from '../tools/executeAuthoringTool'

const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))
Object.defineProperty(window, '__COURSEWARE_ADMISSION_RUN__', { configurable: false, writable: false,
  value: async (raw: unknown) => {
    try {
      const input = dynamicAdmissionPayloadSchema.parse(raw)
      installBundledFontFaces()
      await ensureBundledFonts()
      const assetFiles = Object.fromEntries(Object.entries(input.assetFiles).map(([id, value]) => [id, decode(value)]))
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
        captures = await runDynamicCandidateHostSmoke(input.project, { assetFiles, componentPackages }, input.targets, input.captureInstances)
        // Drain callbacks already queued by teardown before declaring success.
        await new Promise(resolve => setTimeout(resolve, 0))
        if ([...document.body.children].some(child => !bodyChildren.has(child))) failures.push('动态候选销毁后留下宿主外 DOM')
        if (failures.length) throw new AuthoringToolFailure([{ code: 'dynamic-host-failed', message: failures.join('; ').slice(0, 4000), path: [] }])
      } finally {
        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
      }
      return { ok: true, message: '独立进程中的真实宿主准入通过', ...(input.captureInstances ? { captures } : {}) }
    } catch (error) { return { ok: false, message: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
      ...(error instanceof AuthoringToolFailure ? { diagnostics: error.diagnostics } : {}) } }
  },
})

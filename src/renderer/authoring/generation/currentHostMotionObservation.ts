import { z } from 'zod'
import type { AuthoringObservationCaptureImage } from '../../../shared/authoringObservation'

const revision = z.number().int().nonnegative()
const identity = z.string().min(1).max(500)
const frame = z.object({
  fileId: identity, elapsedMs: z.number().finite().nonnegative(), capturedAt: revision,
  width: z.number().int().positive(), height: z.number().int().positive(),
}).strict()

/** Files from the current formal host; admission lifecycle evidence stays separate. */
export const currentHostMotionEvidenceSchema = z.object({
  version: z.literal(1), source: z.literal('actual-current-host'),
  projectId: identity, documentRevision: revision, sessionGeneration: revision,
  viewSource: z.enum(['authoring', 'trial', 'preview']),
  surfaceId: identity, locationId: identity, stateId: identity.nullable(),
  runtime: z.object({ sessionId: identity, stateVersion: revision }).strict().nullable(),
  instances: z.array(z.object({ instanceId: identity, carrier: z.enum(['runtime', 'component']) }).strict()).min(1).max(1000),
  captureRect: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  frames: z.tuple([frame, frame, frame]),
  semanticVerdict: z.literal('requires-review'), privateRuntimeState: z.literal('not-exposed'),
}).strict().superRefine((value, context) => {
  if (value.frames[0].fileId !== 'current-frame' || value.frames[0].elapsedMs !== 0) {
    context.addIssue({ code: 'custom', message: '当前宿主连续观察必须复用首张 current-frame' })
  }
  if (new Set(value.frames.map(item => item.fileId)).size !== 3) {
    context.addIssue({ code: 'custom', message: '当前宿主连续观察文件标识重复' })
  }
  for (const [index, item] of value.frames.entries()) {
    if (item.width !== value.frames[0].width || item.height !== value.frames[0].height
      || (index > 0 && item.elapsedMs < value.frames[index - 1]!.elapsedMs)) {
      context.addIssue({ code: 'custom', message: '当前宿主连续观察的画面尺度或时间顺序不一致' })
    }
  }
})
export type CurrentHostMotionEvidence = z.infer<typeof currentHostMotionEvidenceSchema>

export interface CurrentHostMotionFrame {
  readonly image: AuthoringObservationCaptureImage
  readonly elapsedMs: number
}
export interface CurrentHostMotionPorts {
  capture(): Promise<AuthoringObservationCaptureImage>
  /** The caller owns one immutable identity and fixed capture rectangle for the complete sequence. */
  assertCurrent(): void
  /** Test seams only; production uses a monotonic clock and finite timer waits. */
  now?: () => number
  wait?: (durationMs: number) => Promise<void>
}

/** Observe the already running host. Never pause, resize, rebuild, retry or write its state. */
export async function collectCurrentHostMotion(firstFrame: AuthoringObservationCaptureImage, ports: CurrentHostMotionPorts):
Promise<readonly [CurrentHostMotionFrame, CurrentHostMotionFrame, CurrentHostMotionFrame]> {
  const now = ports.now ?? (() => performance.now())
  const wait = ports.wait ?? (durationMs => new Promise<void>(resolve => setTimeout(resolve, durationMs)))
  const started = now()
  const assertImage = (image: AuthoringObservationCaptureImage) => {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image.dataUrl)
      || !Number.isInteger(image.width) || image.width < 1 || !Number.isInteger(image.height) || image.height < 1
      || !Number.isInteger(image.capturedAt) || image.capturedAt < 0) throw new Error('当前宿主连续观察没有返回实际 PNG 画面')
    if (image.width !== firstFrame.width || image.height !== firstFrame.height) throw new Error('当前宿主连续观察期间画面尺度已变化')
  }
  ports.assertCurrent()
  assertImage(firstFrame)
  const frames: CurrentHostMotionFrame[] = [{ image: firstFrame, elapsedMs: 0 }]
  for (const targetMs of [250, 750]) {
    ports.assertCurrent()
    await wait(Math.max(0, targetMs - (now() - started)))
    ports.assertCurrent()
    const image = await ports.capture()
    ports.assertCurrent()
    assertImage(image)
    frames.push({ image, elapsedMs: Math.max(0, now() - started) })
  }
  ports.assertCurrent()
  return [frames[0]!, frames[1]!, frames[2]!]
}

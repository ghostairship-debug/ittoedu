import { z } from 'zod'
import type { MotionKeyframe } from './motion'

export interface ComponentCameraPose { x: number; y: number; zoom: number; rotation?: number }
/** Intermediate poses are sampled within one finite presentation, not stored camera frames. */
export interface ComponentCameraMotion {
  durationMs?: number
  /** Any CSS easing, including cubic-bezier() and code-generated linear() curves. */
  easing?: string
  keyframes?: readonly { offset: number; pose: ComponentCameraPose; easing?: string }[]
}
/** Generate these keyframes in ordinary code; delays/offsets coordinate both snapshots. */
export interface ComponentNavigationTransition {
  outgoing?: { keyframes: readonly MotionKeyframe[]; timing?: { duration?: number; delay?: number; easing?: string } }
  incoming?: { keyframes: readonly MotionKeyframe[]; timing?: { duration?: number; delay?: number; easing?: string } }
}
export interface ComponentNavigationMotion {
  transition?: ComponentNavigationTransition
  camera?: ComponentCameraMotion
}
export const componentCameraPoseSchema: z.ZodType<ComponentCameraPose> = z.object({
  x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive(), rotation: z.number().finite().optional(),
}).strict()
export const componentCameraMotionSchema: z.ZodType<ComponentCameraMotion> = z.object({
  durationMs: z.number().finite().nonnegative().optional(), easing: z.string().min(1).optional(),
  keyframes: z.array(z.object({ offset: z.number().gt(0).lt(1), pose: componentCameraPoseSchema, easing: z.string().min(1).optional() }).strict())
    .refine(frames => frames.every((frame, index) => index === 0 || frame.offset > frames[index - 1]!.offset), '镜头关键 pose 的 offset 必须递增').optional(),
}).strict()
const snapshotMotionSchema = z.object({
  keyframes: z.array(z.object({ transform: z.string().optional(), opacity: z.number().finite().optional(), offset: z.number().min(0).max(1).optional(), easing: z.string().optional() }).strict()).min(1),
  timing: z.object({ duration: z.number().finite().nonnegative().optional(), delay: z.number().finite().nonnegative().optional(), easing: z.string().min(1).optional() }).strict().optional(),
}).strict()
export const componentNavigationTransitionSchema: z.ZodType<ComponentNavigationTransition> = z.object({
  outgoing: snapshotMotionSchema.optional(), incoming: snapshotMotionSchema.optional(),
}).strict()

import { z } from 'zod'
import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { interactionDefinition, runtimeLifetime } from './shared'

const targetSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('instance'), instanceId: z.string() }).strict(),
  z.object({ kind: z.literal('surface'), surfaceId: z.string() }).strict(), z.object({ kind: z.literal('project') }).strict()])
export const FEEDBACK_DEFINITION = interactionDefinition('guoling.feedback', '答题反馈', 'behavior')
export const VISIBILITY_DEFINITION = interactionDefinition('guoling.visibility', '条件显示', 'behavior')
export const feedbackDataSchema = z.object({ stateKey: z.string(), target: targetSchema,
  pending: z.string().default(''), correct: z.string().default('回答正确'), incorrect: z.string().default('再试一次'), neutral: z.string().default('已提交') }).strict()
export const visibilityDataSchema = z.object({ stateKey: z.string(), target: targetSchema, field: z.string().optional(),
  equals: z.union([z.string(), z.number(), z.boolean(), z.null()]).default(true) }).strict()

export const feedbackRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, scope }) {
    let data = feedbackDataSchema.parse(instance.data), stop = () => {}
    const life = runtimeLifetime(scope)
    let release = () => {}
    const connect = () => {
      stop(); release()
      const target = scope.target(data.target)?.presentation
      if (!target) throw new Error('反馈目标没有可用内容容器')
      const output = target.feedback(); release = output.dispose
      const paint = (value: unknown) => { if (!life.active()) return
        const result = value as { submitted?: boolean; correct?: boolean | null } | undefined
        void output.setText(!result?.submitted ? data.pending : result.correct === true ? data.correct : result.correct === false ? data.incorrect : data.neutral) }
      stop = scope.state.subscribe(data.stateKey, paint); paint(scope.state.get(data.stateKey))
    }
    life.own(() => { stop(); release() }); connect()
    return { update(next) { if (!life.active()) return; data = feedbackDataSchema.parse(next.data); connect() }, dispose: life.dispose }
  },
}
export const visibilityRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, scope }) {
    let data = visibilityDataSchema.parse(instance.data), stop = () => {}, restore = () => {}
    const life = runtimeLifetime(scope)
    const connect = () => {
      stop(); restore()
      const target = scope.target(data.target)?.presentation
      if (!target) throw new Error('条件显示目标没有可用内容容器')
      const visibility = target.visibility(); restore = visibility.dispose
      const paint = (value: unknown) => { if (!life.active()) return
        const actual = data.field && value && typeof value === 'object' ? (value as Record<string, unknown>)[data.field] : value
        void visibility.setVisible(actual === data.equals) }
      stop = scope.state.subscribe(data.stateKey, paint); paint(scope.state.get(data.stateKey))
    }
    life.own(() => { stop(); restore() }); connect()
    return { update(next) { if (!life.active()) return; data = visibilityDataSchema.parse(next.data); connect() }, dispose: life.dispose }
  },
}
/** Ordinary editable source, using the same state/target ports as the builtin. */
export const CONDITIONAL_VISIBILITY_SOURCE = `export default { mount({instance, scope}) {
  let data = structuredClone(instance.data), stop = () => {}, restore = () => {}, disposed = false;
  const connect = () => {
    stop(); restore(); const target = scope.target(data.target)?.presentation;
    if (!target) throw new Error('条件显示目标没有可用内容容器');
    const visibility = target.visibility(); restore = visibility.dispose;
    const paint = value => { if (disposed || !scope.isActive()) return; const actual = data.field ? value?.[data.field] : value; void visibility.setVisible(actual === data.equals); };
    stop = scope.state.subscribe(data.stateKey, paint); paint(scope.state.get(data.stateKey));
  };
  const dispose = () => { if (disposed) return; disposed = true; stop(); restore(); }; scope.cleanup(dispose); connect();
  return { update(next) { if (!disposed) { data = structuredClone(next.data); connect(); } }, dispose };
} };`

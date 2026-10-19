import type { ComponentRuntimeContext, JsonValue } from '../../../shared/contracts/component-platform'

export interface ComponentEnhancementContext extends ComponentRuntimeContext {
  /** Delegated on the stable local root, so replacement children do not retain old listeners. */
  listen(type: string, listener: (event: Event, element: Element | null) => void): () => void
  listen(type: string, selector: string, listener: (event: Event, element: Element) => void): () => void
  /** First value and later values use the same rendering function. */
  observe(key: string, render: (value: JsonValue | undefined) => void): () => void
  /** Aliases are explicit instance references maintained on rename and copy. */
  bindings: {
    get(alias: string): JsonValue | undefined
    set(alias: string, value: JsonValue): void
    observe(alias: string, render: (value: JsonValue | undefined) => void): () => void
  }
}
export type ComponentEnhancement = (context: ComponentEnhancementContext) => void | (() => void) | { dispose(): void | Promise<void> } | Promise<void | (() => void) | { dispose(): void | Promise<void> }>

/** Ordinary JavaScript Source, kept literal so host bundling cannot rename functions or inject free helpers. */
export const componentEnhancementRuntimeSource = String.raw`
export function composeComponentEnhancement(baseModule, enhancementModule) {
  const base = (baseModule.default ?? baseModule.implementation ?? baseModule)
  const enhance = (enhancementModule.default ?? enhancementModule.enhance)
  if (typeof base.mount !== 'function') throw new TypeError('增强的原组件缺少 mount(context)')
  if (typeof enhance !== 'function') throw new TypeError('局部增强模块需要导出 default 函数或 enhance(context)')
  return {
    ...base,
    ...(base.document === 'web' ? { document: 'web' } : {}),
    async mount(context) {
      const mounted = await base.mount(context)
      let instance = context.instance, disposed = false, retire = () => Promise.resolve(), tail = Promise.resolve()
      const active = () => !disposed && context.scope.isActive() && !context.scope.signal.aborted
      const report = (error) => context.scope.events.emit('component.diagnostic', { instanceId: instance.id,
        message: '局部增强更新失败：' + (error instanceof Error ? error.message : String(error)) })
      const start = async () => {
        if (!active()) return
        const controller = new AbortController(), cleanups = new Set(), renders = new Set()
        let disposal = Promise.resolve()
        const alive = () => active() && !controller.signal.aborted
        const own = (cleanup) => {
          let owned = true
          const off = () => {
            if (!owned) return
            owned = false; cleanups.delete(off)
            const result = cleanup()
            if (result?.then) disposal = Promise.all([disposal, result]).then(() => {}, report)
          }
          if (alive()) cleanups.add(off); else off()
          return off
        }
        const stop = () => {
          if (controller.signal.aborted) return disposal
          controller.abort()
          for (const cleanup of [...cleanups].reverse()) { try { cleanup() } catch (error) { report(error) } }
          renders.clear()
          return disposal
        }
        retire = stop
        const repaint = () => { if (alive()) for (const render of [...renders]) render() }
        const scope = { ...context.scope, signal: controller.signal, isActive: alive,
          cleanup: cleanup => { own(cleanup) },
          state: { get: key => alive() ? context.scope.state.get(key) : undefined,
            set: (key, value) => { if (alive()) context.scope.state.set(key, value) },
            subscribe: (key, listener) => own(context.scope.state.subscribe(key, value => { if (alive()) listener(value) })) },
          events: { emit: (name, value) => { if (alive()) context.scope.events.emit(name, value) },
            subscribe: (name, listener) => own(context.scope.events.subscribe(name, value => { if (alive()) listener(value) })) } }
        const listen = (type, selector, listener) => {
          const root = context.root
          if (!root) throw new Error('局部 DOM 监听需要可见内容根')
          const callback = (event) => {
            if (!alive()) return
            if (typeof selector === 'function') { selector(event, event.target instanceof Element ? event.target : null); return }
            const element = event.composedPath().find(node => node instanceof Element && node.matches(selector) && root.contains(node))
            if (element) listener?.(event, element)
          }
          root.addEventListener(type, callback)
          return own(() => root.removeEventListener(type, callback))
        }
        const observe = (key, render) => {
          const paint = () => { if (alive()) render(scope.state.get(key)) }
          renders.add(paint)
          const off = scope.state.subscribe(key, paint)
          paint()
          return own(() => { off(); renders.delete(paint) })
        }
        // Native text can repaint from fonts/layout without a new author-data update.
        scope.events.subscribe('__runtime.text-ranges', value => {
          if (value && typeof value === 'object' && !Array.isArray(value) && value.instanceId === instance.id) repaint()
        })
        if (context.layout) own(context.layout.subscribe(repaint))
        const teacherController = context.teacherController && { ...context.teacherController,
          subscribe: (listener) => own(context.teacherController.subscribe(() => { if (alive()) listener() })) }
        const bindingKey = alias => {
          const key = instance.stateBindings?.[alias]
          if (!key) throw new Error('当前对象未声明状态别名：' + alias)
          return key
        }
        const bindings = { get: alias => scope.state.get(bindingKey(alias)),
          set: (alias, value) => scope.state.set(bindingKey(alias), value),
          observe: (alias, render) => observe(bindingKey(alias), render) }
        try {
          const result = await enhance({ ...context, instance, scope, teacherController, listen, observe, bindings })
          if (typeof result === 'function') own(result)
          else if (result) own(() => result.dispose())
        } catch (error) { await stop(); throw error }
      }
      const cancel = () => { void retire().catch(report) }
      context.scope.signal.addEventListener('abort', cancel, { once: true })
      context.scope.cleanup(cancel)
      try { await start() } catch (error) {
        disposed = true; context.scope.signal.removeEventListener('abort', cancel)
        await mounted.dispose()
        throw error
      }
      const handle = {
        update(next) {
          tail = tail.catch(() => {}).then(async () => {
            if (!active()) return
            await retire()
            if (!active()) return
            await mounted.update(next); instance = next
            await start()
          })
          return tail
        },
        updatePlacement(frame) {
          if (!active()) return
          instance = { ...instance, frame }
          mounted.updatePlacement?.(frame)
        },
        suspend: () => mounted.suspend?.(),
        resume: () => mounted.resume?.(),
        async dispose() {
          if (disposed) return
          disposed = true; await retire(); context.scope.signal.removeEventListener('abort', cancel)
          await mounted.dispose()
        },
      }
      return handle
    },
  }
}


`

export const componentEnhancementWrapperSource = "import * as implementation from './implementation';\nimport * as enhancement from './enhancement';\nimport { composeComponentEnhancement } from './enhancement-runtime';\n\nexport default composeComponentEnhancement(implementation, enhancement);\n"

import type {
  ComponentInstanceLifecycle,
} from './componentTypes'

export type ComponentLifecyclePhase =
  | 'create'
  | 'setMode'
  | 'resize'
  | 'updateProps'
  | 'setEditorState'
  | 'setVisible'
  | 'suspend'
  | 'resume'
  | 'prepareCapture'
  | 'destroy'

export interface ComponentLifecycleFailure {
  phase: ComponentLifecyclePhase
  error: Error
  message: string
  componentId?: string
  instanceId?: string
}

export interface ComponentLifecycleGuardOptions {
  componentId?: string
  instanceId?: string
  onError?(failure: ComponentLifecycleFailure): void
}

export interface GuardedComponentInstanceLifecycle extends ComponentInstanceLifecycle {
  /** The first lifecycle error quarantines future update calls for this instance. */
  getFailure(): ComponentLifecycleFailure | null
  isFailed(): boolean
}

export type ComponentLifecycleCreationResult =
  | { ok: true; lifecycle: GuardedComponentInstanceLifecycle }
  | { ok: false; failure: ComponentLifecycleFailure }

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function failureFrom(
  phase: ComponentLifecyclePhase,
  error: unknown,
  options: ComponentLifecycleGuardOptions,
): ComponentLifecycleFailure {
  const normalized = errorFrom(error)
  return {
    phase,
    error: normalized,
    message: normalized.message,
    componentId: options.componentId,
    instanceId: options.instanceId,
  }
}

function notify(
  options: ComponentLifecycleGuardOptions,
  failure: ComponentLifecycleFailure,
): void {
  try {
    options.onError?.(failure)
  } catch (error) {
    // Host diagnostics must never turn a contained component failure into a
    // scene-wide failure.
    console.error('组件错误回调执行失败', error)
  }
}

function isLifecycle(value: unknown): value is ComponentInstanceLifecycle {
  return typeof value === 'object' && value !== null &&
    typeof (value as { destroy?: unknown }).destroy === 'function'
}

/**
 * Wraps an instance in a fault boundary. The first update-phase exception is
 * retained, reported and quarantines later update calls; destroy is always
 * attempted exactly once and never escapes into the host scene.
 */
export function guardComponentLifecycle(
  lifecycle: ComponentInstanceLifecycle,
  options: ComponentLifecycleGuardOptions = {},
): GuardedComponentInstanceLifecycle {
  let failure: ComponentLifecycleFailure | null = null
  let destroyed = false
  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    try {
      lifecycle.destroy()
    } catch (error) {
      const destroyFailure = failureFrom('destroy', error, options)
      if (!failure) failure = destroyFailure
      notify(options, destroyFailure)
    }
  }

  const run = <T extends unknown[]>(
    phase: Exclude<ComponentLifecyclePhase, 'create' | 'destroy'>,
    operation: ((...args: T) => void) | undefined,
    args: T,
  ): void => {
    if (!operation || failure || destroyed) return
    try {
      operation(...args)
    } catch (error) {
      failure = failureFrom(phase, error, options)
      notify(options, failure)
      destroy()
    }
  }

  const runAsync = async (
    phase: 'prepareCapture',
    operation: (() => void | Promise<void>) | undefined,
  ): Promise<void> => {
    // Export must never treat a quarantined instance as capture-ready. A
    // component may have failed in resize/update/setVisible even when it did
    // not author its own prepareCapture hook, so this check deliberately runs
    // before the optional operation check.
    if (failure) throw failure.error
    if (!operation || destroyed) return
    try {
      await operation()
    } catch (error) {
      failure = failureFrom(phase, error, options)
      notify(options, failure)
      destroy()
      // Capture preparation is part of export correctness. Propagate the
      // normalized failure so the exporter can use its authored fallback
      // instead of silently producing a stale or blank frame.
      throw failure.error
    }
  }

  return {
    ...(lifecycle.setMode
      ? { setMode: (mode) => run('setMode', lifecycle.setMode!.bind(lifecycle), [mode]) }
      : {}),
    ...(lifecycle.resize
      ? { resize: (width, height) => run(
          'resize',
          lifecycle.resize!.bind(lifecycle),
          [width, height],
        ) }
      : {}),
    ...(lifecycle.updateProps
      ? { updateProps: (props) => run(
          'updateProps',
          lifecycle.updateProps!.bind(lifecycle),
          [props],
        ) }
      : {}),
    ...(lifecycle.setEditorState
      ? { setEditorState: (state) => run(
          'setEditorState',
          lifecycle.setEditorState!.bind(lifecycle),
          [state],
        ) }
      : {}),
    ...(lifecycle.setVisible
      ? { setVisible: (visible) => run(
          'setVisible',
          lifecycle.setVisible!.bind(lifecycle),
          [visible],
        ) }
      : {}),
    ...(lifecycle.suspend
      ? { suspend: () => run(
          'suspend',
          lifecycle.suspend!.bind(lifecycle),
          [],
        ) }
      : {}),
    ...(lifecycle.resume
      ? { resume: () => run(
          'resume',
          lifecycle.resume!.bind(lifecycle),
          [],
        ) }
      : {}),
    prepareCapture: () => runAsync(
      'prepareCapture',
      lifecycle.prepareCapture?.bind(lifecycle),
    ),
    destroy,
    getFailure: () => failure,
    isFailed: () => failure !== null,
  }
}

/** Safely invokes a component factory and validates its lifecycle contract. */
export function tryCreateComponentLifecycle(
  factory: () => unknown,
  options: ComponentLifecycleGuardOptions = {},
): ComponentLifecycleCreationResult {
  try {
    const lifecycle = factory()
    if (!isLifecycle(lifecycle)) {
      throw new Error('组件 create() 必须返回含 destroy() 的生命周期对象')
    }
    return {
      ok: true,
      lifecycle: guardComponentLifecycle(lifecycle, options),
    }
  } catch (error) {
    const failure = failureFrom('create', error, options)
    notify(options, failure)
    return { ok: false, failure }
  }
}

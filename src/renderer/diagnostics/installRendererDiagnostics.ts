function reasonDetails(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message || reason.name, stack: reason.stack }
  }
  return { message: String(reason) }
}

/** Runtime findings stay in the existing log, never in the editor's operation-error toast. */
export function reportRendererDiagnostic(reason: unknown, details?: Record<string, unknown>): void {
  const diagnostic = reasonDetails(reason)
  if (!window.desktopAPI?.reportDiagnostic) {
    console.warn(diagnostic.message)
    return
  }
  void window.desktopAPI.reportDiagnostic({
    source: 'renderer',
    ...diagnostic,
    ...(details ? { details } : {}),
  }).catch(() => undefined)
}

export function installRendererDiagnostics(): () => void {
  const onError = (event: ErrorEvent): void => reportRendererDiagnostic(event.error ?? event.message)
  const onRejection = (event: PromiseRejectionEvent): void => reportRendererDiagnostic(event.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

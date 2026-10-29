import type { BrowserContext } from '@playwright/test'

/** Keep offline verification isolated without throwing in opaque Source frames. */
export async function blockOfflineServiceWorkers(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    let container: ServiceWorkerContainer | undefined
    try { container = navigator.serviceWorker }
    catch (error) {
      // Opaque sandbox frames already cannot register a service worker. Only
      // the platform's forbidden getter is expected here; surface other errors.
      if (error instanceof DOMException && error.name === 'SecurityError') return
      throw error
    }
    if (!container) return
    container.register = async () => {
      throw new DOMException('Service worker registration is blocked by offline verification', 'NotAllowedError')
    }
  })
}

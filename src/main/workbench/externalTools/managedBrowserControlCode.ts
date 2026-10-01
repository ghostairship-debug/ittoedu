/** Host-authored window controls only; these strings are never accepted from model or page content. */
export const managedBrowserWindowCode = {
  show: `async (page) => {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 80, top: 60, width: 1200, height: 850 } });
      await page.bringToFront();
      return { visible: true };
    } finally { await cdp.detach(); }
  }`,
  hide: `async (page) => {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      return { visible: false };
    } finally { await cdp.detach(); }
  }`,
} as const
export type ManagedBrowserControlState = { state: 'agent' | 'human' | 'transition' | 'stopped'; pageUrl?: string; snapshotId?: string }

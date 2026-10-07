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

/** Read only the actual DOM target; neither a selector's spelling nor model labels classify an action. */
export const managedBrowserActionFactsCode = `function () {
  const element = this.nodeType === 1 ? this : this.parentElement;
  const target = element.closest('button,input,a,textarea,select,summary') || element;
  const form = target.form || target.closest('form');
  return {
    tag: target.tagName.toLowerCase(), type: target.type || '',
    editable: target.isContentEditable === true,
    formAction: form ? (target.hasAttribute('formaction') ? target.formAction : form.action) : undefined,
    linkUrl: target.tagName === 'A' ? target.href : undefined,
    download: target.tagName === 'A' && target.hasAttribute('download')
  };
}`

import { MAX_RUNTIME_SOURCE_BYTES } from '../contracts/runtime/schema'

export interface HtmlDocumentPayload { html: string; resourceKeys: string[] }

const PREFIX = 'const __htmlDocumentPayload = '
const RESOURCE_KEY = /^[a-f0-9]{64}$/
const PLACEHOLDER = /cw-resource:([a-f0-9]{64})/g

function sourceFor(payload: HtmlDocumentPayload): string {
  return `${PREFIX}${JSON.stringify({ version: 1, ...payload })};
CoursewareRuntime.define({
  protocol: 'surface-runtime', runtimeApiVersion: 3,
  create(context) {
    const iframe = context.dom.root.ownerDocument.createElement('iframe');
    iframe.setAttribute('title', 'HTML 页面');
    iframe.style.cssText = 'display:block;border:0;width:100%;height:100%;';
    const replacements = Object.create(null);
    for (const key of __htmlDocumentPayload.resourceKeys) {
      const url = context.assets.url(key);
      // A URL inserted into HTML, CSS and JS literals must have no delimiter in any of them.
      if (!/^[A-Za-z0-9:/?#[\\]@!$()+,;=%._~-]+$/.test(url)) throw new Error('素材 URL 不能安全嵌入 HTML 页面');
      replacements[key] = url;
    }
    const html = __htmlDocumentPayload.html.replace(/cw-resource:([a-f0-9]{64})/g, (token, key) => {
      if (!Object.prototype.hasOwnProperty.call(replacements, key)) throw new Error('HTML 页面素材绑定缺失：' + key);
      return replacements[key];
    });
    let destroyed = false;
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('HTML 页面加载超时')), 15000);
      iframe.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      iframe.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('HTML 页面加载失败')); }, { once: true });
    });
    context.dom.root.appendChild(iframe);
    iframe.srcdoc = html;
    context.capture.waitUntil(ready);
    return {
      resize(width, height) { iframe.style.height = Math.max(1, height) + 'px'; },
      setVisible(visible) { iframe.style.visibility = visible ? 'visible' : 'hidden'; },
      suspend() { if (iframe.contentDocument) for (const media of iframe.contentDocument.querySelectorAll('audio,video')) media.pause(); },
      resume() {},
      prepareCapture() { return ready; },
      destroy() { if (destroyed) return; destroyed = true; iframe.remove(); iframe.srcdoc = ''; },
    };
  },
});`
}

/** Build a real API 3 source. The caller stores resourceKeys as runtime.assets bindings. */
export function createHtmlDocumentRuntimeSource(input: { html: string; resourceKeys: readonly string[] }): string {
  const resourceKeys = [...new Set(input.resourceKeys)]
  if (resourceKeys.some(key => !RESOURCE_KEY.test(key))) throw new Error('HTML 页面素材键必须是 SHA-256')
  const known = new Set(resourceKeys)
  for (const match of input.html.matchAll(PLACEHOLDER)) {
    if (!known.has(match[1]!)) throw new Error(`HTML 页面素材绑定缺失：${match[1]}`)
  }
  const source = sourceFor({ html: input.html, resourceKeys })
  if (new TextEncoder().encode(source).byteLength > MAX_RUNTIME_SOURCE_BYTES) throw new Error('HTML 页面包装后超过 Runtime 2 MiB 上限')
  return source
}

/** Only the exact structure generated above is unpacked; arbitrary Runtime code is never executed. */
export function unpackHtmlDocumentRuntimeSource(source: string): HtmlDocumentPayload | null {
  if (!source.startsWith(PREFIX)) return null
  const end = source.indexOf(';\n', PREFIX.length)
  if (end < 0) return null
  try {
    const value: unknown = JSON.parse(source.slice(PREFIX.length, end))
    if (!value || typeof value !== 'object') return null
    const payload = value as Record<string, unknown>
    if (payload.version !== 1 || typeof payload.html !== 'string' || !Array.isArray(payload.resourceKeys)
      || payload.resourceKeys.some(key => typeof key !== 'string' || !RESOURCE_KEY.test(key))) return null
    const exact = { html: payload.html, resourceKeys: payload.resourceKeys as string[] }
    return sourceFor(exact) === source ? exact : null
  } catch { return null }
}

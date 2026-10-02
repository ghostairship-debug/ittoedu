import { parse } from 'acorn'
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
    iframe.dataset.htmlDocumentRuntime = 'true';
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
    // srcdoc inherits the host CSP. Parser inserted inline scripts cannot run there,
    // while same-origin Blob scripts are permitted by the host and export policies.
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const scriptUrls = [];
    const eventHandlers = [];
    let handlerCode = '';
    try {
      for (const element of parsed.querySelectorAll('*')) {
        if (element.hasAttribute('data-cw-inline-handler')) throw new Error('HTML 页面事件标记冲突');
        let id = null;
        for (const attribute of Array.from(element.attributes)) {
          if (!/^on[a-z]+$/i.test(attribute.name)) continue;
          const eventName = attribute.name.slice(2).toLowerCase();
          if (id === null) { id = String(eventHandlers.length); element.setAttribute('data-cw-inline-handler', id); }
          eventHandlers.push([id, eventName, attribute.value]);
          element.removeAttribute(attribute.name);
        }
      }
      handlerCode = '(function(){const specs=' + JSON.stringify(eventHandlers) + ';' +
        'for(const element of document.querySelectorAll("[data-cw-inline-handler]")){' +
        'const id=element.getAttribute("data-cw-inline-handler");' +
        'for(const [key,eventName,body] of specs) if(key===id) element["on"+eventName]=new Function("event","with(document){with(this.form||{}){with(this){"+body+"}}}");' +
        'element.removeAttribute("data-cw-inline-handler");}})();';
      let flushUrl = null;
      for (const script of Array.from(parsed.querySelectorAll('script'))) {
        const type = (script.getAttribute('type') || '').trim().toLowerCase();
        if (type && type !== 'module' && !/^(?:text|application)\\/(?:javascript|ecmascript|x-javascript)$/.test(type)) continue;
        if (!script.hasAttribute('src') && script.textContent) {
          const url = URL.createObjectURL(new Blob([script.textContent], { type: 'text/javascript' }));
          scriptUrls.push(url);
          script.textContent = '';
          script.setAttribute('src', url);
          if (type !== 'module') { if (!script.hasAttribute('data-cw-defer')) script.removeAttribute('defer'); script.removeAttribute('async'); }
          script.removeAttribute('data-cw-defer');
        }
        if (eventHandlers.length) {
          if (!flushUrl) {
            flushUrl = URL.createObjectURL(new Blob([handlerCode], { type: 'text/javascript' }));
            scriptUrls.push(flushUrl);
          }
          const flush = parsed.createElement('script');
          flush.setAttribute('src', flushUrl);
          script.before(flush);
        }
      }
      if (eventHandlers.length) {
        if (!flushUrl) {
          flushUrl = URL.createObjectURL(new Blob([handlerCode], { type: 'text/javascript' }));
          scriptUrls.push(flushUrl);
        }
        const tail = parsed.createElement('script');
        tail.setAttribute('src', flushUrl);
        parsed.body.appendChild(tail);
      }
    } catch (error) {
      for (const url of scriptUrls) URL.revokeObjectURL(url);
      throw error;
    }
    const doctype = html.match(/^\\s*<!doctype[^>]*>/i)?.[0] || '';
    const executableHtml = doctype + parsed.documentElement.outerHTML;
    let destroyed = false;
    let suspended = false;
    const pausedMedia = new Set();
    let cancelReady = () => {};
    const ready = new Promise((resolve, reject) => {
      let pending = true;
      const cleanup = () => { clearTimeout(timeout); iframe.removeEventListener('load', onLoad); iframe.removeEventListener('error', onError); };
      const finish = (error) => { if (!pending) return; pending = false; cleanup(); if (error) delete iframe.dataset.htmlDocumentReady; error ? reject(error) : resolve(); };
      const onLoad = () => {
        // A connected iframe may also emit the initial about:blank load.
        if (iframe.contentDocument?.URL !== 'about:srcdoc' || iframe.contentDocument.readyState !== 'complete') return;
        try {
          if (eventHandlers.length) {
            const ChildFunction = iframe.contentWindow?.Function;
            if (!ChildFunction) throw new Error('HTML 页面事件执行环境不可用');
            new ChildFunction(handlerCode)();
          }
          iframe.dataset.htmlDocumentReady = 'true';
          finish();
        } catch (error) { finish(error); }
      };
      const onError = () => finish(new Error('HTML 页面加载失败'));
      const timeout = setTimeout(() => finish(new Error('HTML 页面加载超时')), 15000);
      iframe.addEventListener('load', onLoad);
      iframe.addEventListener('error', onError);
      cancelReady = () => finish(new Error('HTML 页面已销毁'));
    });
    iframe.srcdoc = executableHtml;
    context.dom.root.appendChild(iframe);
    context.capture.waitUntil(ready);
    return {
      resize(width, height) { iframe.style.height = Math.max(1, height) + 'px'; },
      setVisible(visible) { iframe.style.visibility = visible ? 'visible' : 'hidden'; },
      suspend() {
        if (destroyed || suspended) return;
        suspended = true;
        if (iframe.contentDocument) for (const media of iframe.contentDocument.querySelectorAll('audio,video')) {
          if (!media.paused) { pausedMedia.add(media); media.pause(); }
        }
      },
      resume() {
        if (destroyed || !suspended) return;
        suspended = false;
        for (const media of pausedMedia) {
          if (iframe.contentDocument?.contains(media)) {
            try { Promise.resolve(media.play()).catch(() => {}); } catch {}
          }
        }
        pausedMedia.clear();
      },
      prepareCapture() { return ready; },
      destroy() { if (destroyed) return; destroyed = true; pausedMedia.clear(); cancelReady(); delete iframe.dataset.htmlDocumentReady; iframe.remove(); iframe.srcdoc = ''; for (const url of scriptUrls) URL.revokeObjectURL(url); },
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

/** JSON literals only: never execute a candidate Runtime to recover its HTML. */
function literalValue(node: unknown): unknown {
  if (!node || typeof node !== 'object') throw new Error('Expected literal')
  const n = node as Record<string, unknown>
  if (n.type === 'Literal' && !n.regex && (n.value === null || ['string', 'boolean', 'number'].includes(typeof n.value))) return n.value
  if (n.type === 'ArrayExpression' && Array.isArray(n.elements)) return n.elements.map(literalValue)
  if (n.type === 'ObjectExpression' && Array.isArray(n.properties)) {
    const result: Record<string, unknown> = Object.create(null)
    for (const raw of n.properties) {
      const property = raw as Record<string, unknown>, keyNode = property.key as Record<string, unknown> | undefined
      if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method || property.shorthand || !keyNode) throw new Error('Expected JSON property')
      const key = keyNode.type === 'Identifier' ? keyNode.name : keyNode.type === 'Literal' ? keyNode.value : null
      if (typeof key !== 'string' || Object.hasOwn(result, key)) throw new Error('Invalid literal property')
      result[key] = literalValue(property.value)
    }
    return result
  }
  throw new Error('Executable expression is not a payload')
}

function payloadValue(value: unknown): HtmlDocumentPayload | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Record<string, unknown>
  if (Object.keys(payload).length !== 3 || payload.version !== 1 || typeof payload.html !== 'string' || !Array.isArray(payload.resourceKeys)
    || payload.resourceKeys.some(key => typeof key !== 'string' || !RESOURCE_KEY.test(key))
    || new Set(payload.resourceKeys).size !== payload.resourceKeys.length) return null
  return { html: payload.html, resourceKeys: payload.resourceKeys as string[] }
}

/** Whitespace, comments and literal quoting do not change executable syntax. */
function syntaxKey(ast: unknown): string {
  return JSON.stringify(ast, (key, value) => ['start', 'end', 'loc', 'raw'].includes(key) ? undefined
    : value instanceof RegExp ? { pattern: value.source, flags: value.flags } : value)
}

/** A software-owned envelope, including provably cosmetic formatting changes, never arbitrary custom code. */
export function unpackHtmlDocumentRuntimeSource(source: string): HtmlDocumentPayload | null {
  if (new TextEncoder().encode(source).byteLength > MAX_RUNTIME_SOURCE_BYTES) return null
  try {
    // Keep the common software-produced form cheap; parse syntax only for a reformatted candidate.
    if (source.startsWith(PREFIX)) {
      const end = source.indexOf(';\n', PREFIX.length)
      if (end >= 0) {
        try {
          const payload = payloadValue(JSON.parse(source.slice(PREFIX.length, end)))
          if (payload && createHtmlDocumentRuntimeSource(payload) === source) return payload
        } catch { /* A valid JavaScript literal may use non-JSON quoting; static parsing below decides. */ }
      }
    }
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
    const first = ast.body[0]
    if (first?.type !== 'VariableDeclaration' || first.kind !== 'const' || first.declarations.length !== 1) return null
    const declaration = first.declarations[0]
    if (declaration.id.type !== 'Identifier' || declaration.id.name !== '__htmlDocumentPayload') return null
    const payload = payloadValue(literalValue(declaration.init))
    if (!payload) return null
    const owned = parse(createHtmlDocumentRuntimeSource(payload), { ecmaVersion: 'latest', sourceType: 'script' })
    // The literal payload was already decoded and validated; its property order/quoting is immaterial.
    ast.body[0] = owned.body[0]
    return syntaxKey(ast) === syntaxKey(owned) ? payload : null
  } catch { return null }
}

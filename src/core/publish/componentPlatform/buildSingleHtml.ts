import type { PublishedCourseV4 } from '../../../shared/contracts/component-platform/published'
import { restoreSerializedResourcePool, serializeResourcePool } from '../../../shared/serializedResourcePool'

const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const scriptLiteral = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c')
interface HtmlResourceOptions { preparedAssetScriptUrl?: string; preparedFontScriptUrl?: string; fontFaceCssElementId?: string }

/** Parseable independently of the player, so bundle/JSON/entry failures stay visible. */
function earlyPlaybackScript(): string {
  return `(function(){var diagnostic=document.getElementById('course-diagnostic');window.__coursePlaybackFailure=function(error){if(window.__coursePlaybackFailed)return;window.__coursePlaybackFailed=true;window.__coursePlaybackError=error;diagnostic.hidden=false;diagnostic.setAttribute('role','alert');diagnostic.style.color='#b91c1c';diagnostic.textContent='课件加载失败：'+(error&&error.message?error.message:String(error));};window.__coursePlaybackDiagnostic=function(message,issue){if(window.__coursePlaybackFailed)return;var text=(issue&&issue.code?'['+issue.code+'] ':'')+message;diagnostic.textContent=diagnostic.getAttribute('data-has-diagnostic')?diagnostic.textContent+'\\n'+text:'课件诊断：'+text;diagnostic.setAttribute('data-has-diagnostic','true');diagnostic.hidden=false;diagnostic.setAttribute('role','status');diagnostic.style.color=issue&&issue.severity==='error'?'#b91c1c':'#92400e';};window.addEventListener('error',function(event){if(event.target!==window&&(!event.target||event.target.tagName!=='SCRIPT'))return;window.__coursePlaybackFailure(event.error||event.message||(event.target&&event.target.src?'脚本资源加载失败：'+event.target.src:'运行时错误'));},true);window.addEventListener('unhandledrejection',function(event){window.__coursePlaybackFailure(event.reason);});})();`
}

function singleHtml(payload: { title: string }, playerBundle: string, entry: string,
  options: HtmlResourceOptions): string {
  const serialized = serializeResourcePool(payload)
  const encoded = JSON.stringify(serialized.data).replace(/</g, '\\u003c')
  const pool = serialized.pool ? `<script id="course-resource-pool" type="application/json">${JSON.stringify(serialized.pool).replace(/</g, '\\u003c')}</script>` : ''
  const bundle = playerBundle.replace(/<\/script/gi, '<\\/script')
  const fontScript = options.preparedFontScriptUrl ? `<script src="${escapeAttribute(options.preparedFontScriptUrl)}"></script>` : ''
  const preparesNativeAssets = entry === 'CoursewareCompiledPlayer.mountCompiledCourse'
  const assetOption = options.preparedAssetScriptUrl ? `preparedAssetBytes:window.CoursewarePreparedAssetBytes,${preparesNativeAssets ? 'prepareAssetBytes:prepareAssetBytes,' : ''}` : ''
  // HTTP uses cacheable package files. Only file:// needs the classic-script
  // byte carrier, because fetch cannot read beside an extracted local document.
  const assetLoader = options.preparedAssetScriptUrl ? `var assetPreparation;function prepareAssetBytes(){if(window.CoursewarePreparedAssetBytes)return Promise.resolve(window.CoursewarePreparedAssetBytes);return assetPreparation||(assetPreparation=new Promise(function(resolve,reject){var script=document.createElement('script');script.src=${scriptLiteral(options.preparedAssetScriptUrl)};script.onload=function(){if(!window.CoursewarePreparedAssetBytes){reject(new Error('资源脚本没有提供素材字节'));return;}resolve(window.CoursewarePreparedAssetBytes);};script.onerror=function(){reject(new Error('离线资源脚本加载失败'));};document.head.appendChild(script);}));}` : ''
  // The Published entry consumes bytes directly; retain that existing contract.
  // Compiled playback can prepare its native-directory bytes at first use.
  const prepared = options.preparedAssetScriptUrl ? preparesNativeAssets ? `location.protocol==='file:'?prepareAssetBytes():Promise.resolve()` : 'prepareAssetBytes()' : 'Promise.resolve()'
  const fontOption = options.fontFaceCssElementId ? `fontFaceCss:window.CoursewarePreparedFontFaceCss||((document.getElementById(${scriptLiteral(options.fontFaceCssElementId)})||{}).textContent||"").replace(/url\\((['"]?)([^'")]+)\\1\\)/g,function(all,quote,url){return /^(?:data:|blob:|https?:|file:)/i.test(url)?all:'url('+JSON.stringify(new URL(url,document.baseURI).href)+')';}),` : ''
  const mount = `(function(){${assetLoader}window.coursePlayerReady=(${prepared}).then(function(){if(window.__coursePlaybackFailed)throw window.__coursePlaybackError;var element=document.getElementById('course-data'),pool=document.getElementById('course-resource-pool');var course=(${restoreSerializedResourcePool.toString()})(JSON.parse(element.textContent),pool?JSON.parse(pool.textContent):undefined);element.__courseDecodedPayload=course;return ${entry}(course,document.getElementById('course-root'),{${assetOption}${fontOption}report:function(message,issue){window.__coursePlaybackDiagnostic(message,issue);}});}).then(function(player){window.coursePlayer=player;var diagnostic=document.getElementById('course-diagnostic');if(!window.__coursePlaybackFailed&&!diagnostic.getAttribute('data-has-diagnostic'))diagnostic.hidden=true;return player;},function(error){window.__coursePlaybackFailure(error);throw error;});window.coursePlayerReady.catch(function(){});})();`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeAttribute(payload.title)}</title><style>html,body{margin:0;width:100%;height:100%;background:#eef2f7}#course-root{width:100%;height:100%;overflow:hidden}#course-diagnostic{position:fixed;bottom:0;left:0;max-width:100%;box-sizing:border-box;padding:8px 12px;background:#fff;color:#475569;z-index:10000}</style></head><body><main id="course-root"></main><div id="course-diagnostic" role="status" aria-live="polite">正在加载课件…</div><script>${earlyPlaybackScript().replace(/<\/script/gi, '<\\/script')}</script><script id="course-data" type="application/json">${encoded}</script>${pool}<script>${bundle}</script>${fontScript}<script>${mount.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
}

/** Fixed host template; source remains JSON data until the isolated runtime loads compiled ESM. */
export function buildComponentSingleHtml(payload: PublishedCourseV4, playerBundle: string, options: HtmlResourceOptions = {}): string {
  return singleHtml(payload, playerBundle, 'CoursewarePlayer.mountPublishedCourseV4', options)
}

/** Final delivery template consumes materialized compiled content and the shared runtime only. */
export function buildCompiledSingleHtml(artifact: import('./compiledContract').CompiledCoursePlayback, runtimeBundle: string, options: HtmlResourceOptions = {}): string {
  return singleHtml(artifact, runtimeBundle, 'CoursewareCompiledPlayer.mountCompiledCourse', options)
}

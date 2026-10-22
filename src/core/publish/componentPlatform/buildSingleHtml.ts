import type { PublishedCourseV4 } from '../../../shared/contracts/component-platform/published'

const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const scriptLiteral = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c')

/** Parseable independently of the player, so bundle/JSON/entry failures stay visible. */
function earlyPlaybackScript(): string {
  return `(function(){var diagnostic=document.getElementById('course-diagnostic');window.__coursePlaybackFailure=function(error){if(window.__coursePlaybackFailed)return;window.__coursePlaybackFailed=true;window.__coursePlaybackError=error;diagnostic.hidden=false;diagnostic.setAttribute('role','alert');diagnostic.style.color='#b91c1c';diagnostic.textContent='课件加载失败：'+(error&&error.message?error.message:String(error));};window.__coursePlaybackDiagnostic=function(message,issue){if(window.__coursePlaybackFailed)return;var text=(issue&&issue.code?'['+issue.code+'] ':'')+message;diagnostic.textContent=diagnostic.getAttribute('data-has-diagnostic')?diagnostic.textContent+'\\n'+text:'课件诊断：'+text;diagnostic.setAttribute('data-has-diagnostic','true');diagnostic.hidden=false;diagnostic.setAttribute('role','status');diagnostic.style.color=issue&&issue.severity==='error'?'#b91c1c':'#92400e';};window.addEventListener('error',function(event){if(event.target!==window&&(!event.target||event.target.tagName!=='SCRIPT'))return;window.__coursePlaybackFailure(event.error||event.message||(event.target&&event.target.src?'脚本资源加载失败：'+event.target.src:'运行时错误'));},true);window.addEventListener('unhandledrejection',function(event){window.__coursePlaybackFailure(event.reason);});})();`
}

function singleHtml(payload: { title: string }, playerBundle: string, entry: string,
  options: { preparedAssetScriptUrl?: string; fontFaceCssElementId?: string }): string {
  const encoded = JSON.stringify(payload).replace(/</g, '\\u003c')
  const bundle = playerBundle.replace(/<\/script/gi, '<\\/script')
  const assetScript = options.preparedAssetScriptUrl ? `<script src="${escapeAttribute(options.preparedAssetScriptUrl)}"></script>` : ''
  const assetOption = options.preparedAssetScriptUrl ? 'preparedAssetBytes:window.CoursewarePreparedAssetBytes,' : ''
  const fontOption = options.fontFaceCssElementId ? `fontFaceCss:(document.getElementById(${scriptLiteral(options.fontFaceCssElementId)})||{}).textContent||"",` : ''
  const mount = `(function(){try{if(window.__coursePlaybackFailed)throw window.__coursePlaybackError;var course=JSON.parse(document.getElementById('course-data').textContent);window.coursePlayerReady=Promise.resolve(${entry}(course,document.getElementById('course-root'),{${assetOption}${fontOption}report:function(message,issue){window.__coursePlaybackDiagnostic(message,issue);}})).then(function(player){window.coursePlayer=player;var diagnostic=document.getElementById('course-diagnostic');if(!window.__coursePlaybackFailed&&!diagnostic.getAttribute('data-has-diagnostic'))diagnostic.hidden=true;return player;},function(error){window.__coursePlaybackFailure(error);throw error;});}catch(error){window.__coursePlaybackFailure(error);window.coursePlayerReady=Promise.reject(error);window.coursePlayerReady.catch(function(){});}})();`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeAttribute(payload.title)}</title><style>html,body{margin:0;width:100%;height:100%;background:#eef2f7}#course-root{width:100%;height:100%;overflow:hidden}#course-diagnostic{position:fixed;bottom:0;left:0;max-width:100%;box-sizing:border-box;padding:8px 12px;background:#fff;color:#475569;z-index:10000}</style></head><body><main id="course-root"></main><div id="course-diagnostic" role="status" aria-live="polite">正在加载课件…</div><script>${earlyPlaybackScript().replace(/<\/script/gi, '<\\/script')}</script><script id="course-data" type="application/json">${encoded}</script><script>${bundle}</script>${assetScript}<script>${mount}</script></body></html>`
}

/** Fixed host template; source remains JSON data until the isolated runtime loads compiled ESM. */
export function buildComponentSingleHtml(payload: PublishedCourseV4, playerBundle: string, options: { preparedAssetScriptUrl?: string; fontFaceCssElementId?: string } = {}): string {
  return singleHtml(payload, playerBundle, 'CoursewarePlayer.mountPublishedCourseV4', options)
}

/** Final delivery template consumes materialized compiled content and the shared runtime only. */
export function buildCompiledSingleHtml(artifact: import('./compiledContract').CompiledCoursePlayback, runtimeBundle: string, options: { fontFaceCssElementId?: string; preparedAssetScriptUrl?: string } = {}): string {
  return singleHtml(artifact, runtimeBundle, 'CoursewareCompiledPlayer.mountCompiledCourse', options)
}

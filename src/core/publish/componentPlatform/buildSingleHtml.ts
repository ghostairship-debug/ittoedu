import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'

/** Fixed host template; source remains JSON data until the isolated runtime loads compiled ESM. */
export function buildComponentSingleHtml(payload: PublishedCourseV3, playerBundle: string, options: { preparedAssetScriptUrl?: string } = {}): string {
  const title = payload.title.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)
  const encoded = JSON.stringify(payload).replace(/</g, '\\u003c')
  const bundle = playerBundle.replace(/<\/script/gi, '<\\/script')
  const assetScript = options.preparedAssetScriptUrl
    ? `<script src="${options.preparedAssetScriptUrl.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)}"></script>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;background:#eef2f7}#course-root{width:100%;height:100%;overflow:hidden}#course-diagnostic{position:fixed;bottom:0;left:0;background:#fff;color:#b91c1c;z-index:10000}</style></head><body><main id="course-root"></main><div id="course-diagnostic" role="alert"></div><script id="course-data" type="application/json">${encoded}</script><script>${bundle}</script>${assetScript}<script>const course=JSON.parse(document.getElementById('course-data').textContent);CoursewarePlayer.mountPublishedCourseV3(course,document.getElementById('course-root'),{${assetScript ? 'preparedAssetBytes:window.CoursewarePreparedAssetBytes,' : ''}report:message=>{document.getElementById('course-diagnostic').textContent=message}}).then(player=>{window.coursePlayer=player}).catch(error=>{document.getElementById('course-diagnostic').textContent=String(error)});</script></body></html>`
}

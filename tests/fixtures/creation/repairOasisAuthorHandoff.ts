/** A bounded authoring pilot for a copy of Oasis 04. No asset is regenerated.
 * The scene's two existing translucent overlays paint inside the image's SVG
 * filter, so the ordinary image remains the paint owner for native authoring.
 * We deliberately do not weaken the platform's real-foreground hit contract.
 */
export const OASIS_04_SHA256 = '7471cf0b771d8c31cde8efc8c60c92ba264b681d12f2dceda265d155f822fcc6'
export const OASIS_HANDOFF_DESCRIPTION = '你是微光号的实习科学官。此次任务：定位失联站、回收观测核心，也守住生命带。'
export const OASIS_HANDOFF_TEACHER_NOTE = ' 教师提示：先留下观测，再说明判断依据。'
export const OASIS_HANDOFF_IMAGE = '[data-scene-key="intro-illustration"]'

function replaceOnce(source: string, before: string, after: string): string {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0)
    throw new Error(`The Oasis intro authoring anchor must occur exactly once: ${before.slice(0, 110)}`)
  return source.slice(0, first) + after + source.slice(first + before.length)
}

export function repairOasisAuthorHandoff(intro: string): string {
  if (intro.includes('intro-illustration') || intro.includes('oasis-intro-scene-shade'))
    throw new Error('The authoring pilot has already been applied; use the unchanged Oasis 04 copy')
  // Same order as the original CSS: first the image's .1→.55 overlay, then
  // .scene::after's .13→.85 overlay; the surrounding .scene still has opacity .75.
  const shade = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none">'
    + '<defs><linearGradient id="first" x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="rgb(2,17,30)" stop-opacity=".1"/><stop offset="1" stop-color="rgb(2,17,30)" stop-opacity=".55"/></linearGradient>'
    + '<linearGradient id="second" x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="rgb(2,15,24)" stop-opacity=".13"/><stop offset="1" stop-color="rgb(2,15,24)" stop-opacity=".85"/></linearGradient></defs>'
    + '<rect width="1" height="1" fill="url(#first)"/><rect width="1" height="1" fill="url(#second)"/></svg>'
  const filter = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden;pointer-events:none">'
    + '<defs><filter id="oasis-intro-scene-shade" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">'
    + `<feImage href="data:image/svg+xml,${encodeURIComponent(shade)}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="scene-shade"/>`
    + '<feComposite in="scene-shade" in2="SourceGraphic" operator="over"/></filter></defs></svg>'
  let next = replaceOnce(intro,
    '<div class="scene" aria-hidden="true"></div>',
    '<div class="scene" aria-hidden="true">' + filter
      + '<img class="scene-image" data-scene-key="intro-illustration" data-scene-state="${state.phase}" alt="" draggable="false"></div>')
  next = replaceOnce(next,
    '.og-narrative .scene:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(2,15,24,.13),rgba(2,15,24,.85))}',
    '.og-narrative .scene-image{display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:url(#oasis-intro-scene-shade)}')
  next = replaceOnce(next,
    'if (asset) section.querySelector(\'.scene\').style.backgroundImage = `linear-gradient(180deg,rgba(2,17,30,.1),rgba(2,17,30,.55)),url(${JSON.stringify(String(asset))})`;',
    'if (asset) section.querySelector(\'.scene-image\').setAttribute(\'src\', String(asset));')
  return next
}

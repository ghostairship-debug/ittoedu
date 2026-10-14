/** Semantic delivery deduplication: restore exact inline declaration priority before any authored program executes. */
export function compactPublishedWebMarkup(html: string, dom: Document): { html: string; declarations?: string[] } {
  const parser = new dom.defaultView!.DOMParser(), parsed = parser.parseFromString(html, 'text/html')
  const declarations: string[] = [], indices = new Map<string, number>()
  for (const element of parsed.querySelectorAll<HTMLElement | SVGElement>('[style]')) {
    if (!element.style.length) continue
    const ids: number[] = []
    const original=element.getAttribute('style')!,parts:string[]=[]
    let start=0,quote='',depth=0,comment=false
    for(let offset=0;offset<original.length;offset++){
      const char=original[offset],next=original[offset+1]
      if(comment){if(char==='*'&&next==='/'){comment=false;offset++}continue}
      if(quote){if(char==='\\'){offset++;continue}if(char===quote)quote='';continue}
      if(char==='/'&&next==='*'){comment=true;offset++;continue}
      if(char==='"'||char==="'"){quote=char;continue}
      if('([{'.includes(char))depth++
      else if(')]}'.includes(char))depth--
      else if(char===';'&&depth===0){parts.push(original.slice(start,offset+1));start=offset+1}
    }
    if(start<original.length)parts.push(original.slice(start))
    for(const declaration of parts){let id=indices.get(declaration);if(id===undefined){id=declarations.length;indices.set(declaration,id);declarations.push(declaration)}ids.push(id)}
    element.removeAttribute('style'); element.setAttribute('data-guoling-delivery-style', ids.join(' '))
  }
  const compact = parsed.documentElement.outerHTML
  return compact.length + JSON.stringify(declarations).length < html.length ? { html: compact, declarations } : { html }
}
export function restorePublishedWebMarkup(html: string, declarations: readonly string[] | undefined, dom: Document): string {
  if (!declarations) return html
  const parsed = new dom.defaultView!.DOMParser().parseFromString(html, 'text/html')
  for (const element of parsed.querySelectorAll('[data-guoling-delivery-style]')) {
    const ids = element.getAttribute('data-guoling-delivery-style')!.split(' ').map(Number)
    element.setAttribute('style', ids.map(id => declarations[id]).join('')); element.removeAttribute('data-guoling-delivery-style')
  }
  return parsed.documentElement.outerHTML
}

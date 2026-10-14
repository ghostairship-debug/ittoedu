/** Child content realms need their own faces; relative font URLs belong to the host. */
export function installedBundledFontFaceCss(target: Document): string {
  const faces = (target.getElementById('bundled-font-faces')?.textContent ?? '').replace(
    /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
    (original, _quote: string, source: string) => {
      try { return `url(${JSON.stringify(new URL(source, target.baseURI).href)})` }
      catch { return original }
    },
  )
  return faces ? `/* guoling-bundled-font-faces:start */${faces}/* guoling-bundled-font-faces:end */` : ''
}

export function splitInstalledBundledFontFaceCss(css: string): { faces: string; theme: string } {
  const blocks: string[] = []
  const theme = css.replace(/\/\* guoling-bundled-font-faces:start \*\/[\s\S]*?\/\* guoling-bundled-font-faces:end \*\//g, block => { blocks.push(block); return '' })
  return { faces: blocks.join('\n'), theme }
}

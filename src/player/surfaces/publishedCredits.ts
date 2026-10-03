import type { PublishedCourseCredit } from '../../shared/publishedCourseTypes'

/**
 * Credits of attributed assets: a small, faint "来源" button in the player corner,
 * outside the course picture, that opens a closable list. Absent without credits.
 */
export function mountPublishedCredits(root: HTMLElement, credits: readonly PublishedCourseCredit[] | undefined): () => void {
  if (!credits?.length) return () => undefined
  const document = root.ownerDocument
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.courseCredits = 'button'
  button.textContent = 'ⓘ 来源'
  button.title = '素材来源与授权'
  button.setAttribute('aria-haspopup', 'dialog')
  button.style.cssText = 'position:fixed;right:8px;bottom:6px;z-index:2147483000;padding:2px 6px;border:0;border-radius:6px;'
    + 'background:transparent;color:#64748b;font:12px/1.4 system-ui,"Microsoft YaHei",sans-serif;opacity:.4;cursor:pointer;transition:opacity .15s'
  const reveal = (value: boolean) => { button.style.opacity = value ? '1' : '.4' }
  button.addEventListener('pointerenter', () => reveal(true))
  button.addEventListener('pointerleave', () => reveal(document.activeElement === button))
  button.addEventListener('focus', () => reveal(true))
  button.addEventListener('blur', () => reveal(false))

  let panel: HTMLElement | null = null
  const close = () => {
    panel?.remove()
    panel = null
    button.setAttribute('aria-expanded', 'false')
  }
  const link = (href: string, text: string) => {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.textContent = text
    anchor.style.color = '#2563eb'
    return anchor
  }
  const open = () => {
    panel = document.createElement('section')
    panel.dataset.courseCredits = 'panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', '素材来源')
    panel.style.cssText = 'position:fixed;right:8px;bottom:32px;z-index:2147483000;box-sizing:border-box;width:min(420px,calc(100vw - 16px));max-height:60vh;overflow:auto;'
      + 'padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#1f2937;box-shadow:0 12px 32px #0f172a2e;'
      + 'font:13px/1.55 system-ui,"Microsoft YaHei",sans-serif'
    const header = document.createElement('header')
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-weight:600'
    const title = document.createElement('span')
    title.textContent = '素材来源'
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = '关闭'
    dismiss.style.cssText = 'border:0;background:transparent;color:#64748b;cursor:pointer;font:inherit'
    dismiss.addEventListener('click', close)
    header.append(title, dismiss)
    const list = document.createElement('ol')
    list.style.cssText = 'margin:0;padding-left:20px'
    for (const credit of credits) {
      const entry = document.createElement('li')
      entry.style.margin = '6px 0'
      entry.append(credit.attribution)
      const details: Array<string | HTMLElement> = []
      if (credit.url) details.push(link(credit.url, '出处'))
      if (credit.license) details.push(credit.license.url ? link(credit.license.url, credit.license.id) : credit.license.id)
      if (details.length) {
        const line = document.createElement('div')
        line.style.cssText = 'color:#64748b;font-size:12px'
        details.forEach((detail, index) => { if (index) line.append(' · '); line.append(detail) })
        entry.append(line)
      }
      list.append(entry)
    }
    panel.append(header, list)
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); button.focus() } })
    root.append(panel)
    button.setAttribute('aria-expanded', 'true')
    dismiss.focus()
  }
  button.addEventListener('click', () => { if (panel) close(); else open() })
  root.append(button)
  return () => { close(); button.remove() }
}

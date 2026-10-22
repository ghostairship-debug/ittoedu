import { useEffect, useRef, useState } from 'react'
import type { AttachmentSnapshot } from '../../../shared/workbench/attachments'
import type { AttachmentsDesktopAPI } from '../../../shared/workbench/attachmentsDesktop'
export function AttachmentThumbnail({ api, snapshot }: { api?: AttachmentsDesktopAPI; snapshot: AttachmentSnapshot }) {
  const [url, setURL] = useState<string>()
  const [visibleKey, setVisibleKey] = useState<string>()
  const host = useRef<HTMLSpanElement>(null)
  const representation = snapshot.representations.find(item => item.kind === 'image')
  const key = JSON.stringify([snapshot.id, representation?.id])
  const visible = visibleKey === key
  useEffect(() => {
    if (!host.current) return
    if (typeof IntersectionObserver === 'undefined') { setVisibleKey(key); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisibleKey(key); observer.disconnect() }
    })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [key, api?.readThumbnail])
  useEffect(() => {
    setURL(undefined)
    if (!api?.readThumbnail || !representation || !visible) return
    let active = true, owned: string | undefined
    void api.readThumbnail(snapshot.id, representation.id).then(read => {
      if (!active) return
      owned = URL.createObjectURL(new Blob([Uint8Array.from(read.bytes).buffer], { type: read.mediaType })); setURL(owned)
    }).catch(() => undefined)
    return () => { active = false; if (owned) URL.revokeObjectURL(owned) }
  }, [api, snapshot.id, representation?.id, visible])
  return api?.readThumbnail && representation ? <span ref={host} style={{ width: 64, height: 64, display: 'block' }}>
    {url && <img src={url} alt={`${snapshot.name}缩略图`} style={{ width: 64, height: 64, objectFit: 'contain', display: 'block' }} />}
  </span> : null
}

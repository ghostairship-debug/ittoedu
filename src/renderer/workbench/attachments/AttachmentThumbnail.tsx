import { useEffect, useState } from 'react'
import type { AttachmentSnapshot } from '../../../shared/workbench/attachments'
import type { AttachmentsDesktopAPI } from '../../../shared/workbench/attachmentsDesktop'
export function AttachmentThumbnail({ api, snapshot }: { api?: AttachmentsDesktopAPI; snapshot: AttachmentSnapshot }) {
  const [url, setURL] = useState<string>()
  const representation = snapshot.representations.find(item => item.kind === 'image')
  useEffect(() => {
    if (!api || !representation) return
    let active = true, owned: string | undefined
    void api.readRepresentation(snapshot.id, representation.id).then(read => {
      if (!active) return
      owned = URL.createObjectURL(new Blob([Uint8Array.from(read.bytes).buffer], { type: representation.mediaType })); setURL(owned)
    }).catch(() => undefined)
    return () => { active = false; if (owned) URL.revokeObjectURL(owned) }
  }, [api, snapshot.id, representation?.id])
  return url ? <img src={url} alt={`${snapshot.name}缩略图`} style={{ width: 64, height: 64, objectFit: 'contain', display: 'block' }} /> : null
}

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentThumbnail } from '../../src/renderer/workbench/attachments/AttachmentThumbnail'
import type { AttachmentSnapshot } from '../../src/shared/workbench/attachments'
import type { AttachmentsDesktopAPI } from '../../src/shared/workbench/attachmentsDesktop'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('requests small bytes only after visibility and releases URLs without reading the model representation', async () => {
  const observers: Array<{ notify: IntersectionObserverCallback; observer: IntersectionObserver }> = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(notify: IntersectionObserverCallback) { observers.push({ notify, observer: this as unknown as IntersectionObserver }) }
    observe() {}; disconnect() {}
  })
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:thumbnail' }; static revokeObjectURL = revoke })
  const readThumbnail = vi.fn(async () => ({ bytes: new Uint8Array([1]), mediaType: 'image/png' }))
  const readRepresentation = vi.fn()
  const api = { readThumbnail, readRepresentation } as unknown as AttachmentsDesktopAPI
  const snapshot = { id: 'first', name: 'photo', representations: [{ id: 'original-image', kind: 'image', mediaType: 'image/jpeg' }] } as AttachmentSnapshot
  const view = render(<AttachmentThumbnail api={api} snapshot={snapshot} />)
  expect(readThumbnail).not.toHaveBeenCalled()
  await act(async () => observers[0]!.notify([{ isIntersecting: false } as IntersectionObserverEntry], observers[0]!.observer))
  expect(readThumbnail).not.toHaveBeenCalled()
  await act(async () => observers[0]!.notify([{ isIntersecting: true } as IntersectionObserverEntry], observers[0]!.observer))
  expect(readThumbnail).toHaveBeenCalledWith('first', 'original-image')
  expect(screen.getByAltText('photo缩略图')).toBeVisible()
  view.rerender(<AttachmentThumbnail api={api} snapshot={{ ...snapshot, id: 'second' }} />)
  expect(readThumbnail).toHaveBeenCalledTimes(1)
  await act(async () => observers[1]!.notify([{ isIntersecting: true } as IntersectionObserverEntry], observers[1]!.observer))
  expect(readThumbnail).toHaveBeenCalledWith('second', 'original-image')
  expect(readRepresentation).not.toHaveBeenCalled()
  view.unmount(); expect(revoke).toHaveBeenCalledTimes(2)
})

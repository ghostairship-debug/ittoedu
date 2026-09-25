import { describe, expect, it, vi } from 'vitest'
import type { Session, WebContents } from 'electron'
import { configureRestrictedSession, isAllowedRendererPermission, mediaCaptureTypes, type MediaCaptureRequest } from '../../src/main/security'

type RequestHandler = (contents: WebContents, permission: string, callback: (granted: boolean) => void, details: unknown) => void
function fakeSession() {
  const handlers: { request?: RequestHandler; check?: (contents: unknown, permission: string) => boolean;
    device?: () => boolean; display?: (request: unknown, callback: (streams: object) => void) => void } = {}
  const session = {
    setPermissionCheckHandler: (handler: typeof handlers.check) => { handlers.check = handler },
    setPermissionRequestHandler: (handler: RequestHandler) => { handlers.request = handler },
    setDevicePermissionHandler: (handler: typeof handlers.device) => { handlers.device = handler },
    setDisplayMediaRequestHandler: (handler: typeof handlers.display) => { handlers.display = handler },
    on: () => undefined,
    webRequest: { onBeforeRequest: () => undefined },
  } as unknown as Session
  return { session, handlers }
}
const contents = {} as WebContents
const decide = (handler: RequestHandler, permission: string, details: unknown) =>
  new Promise<boolean>(resolve => handler(contents, permission, resolve, details))

describe('M13-T03 course camera/microphone permission port', () => {
  it('recognises only non-empty camera/microphone requests', () => {
    expect(mediaCaptureTypes('media', { mediaTypes: ['audio'] })).toEqual(['audio'])
    expect(mediaCaptureTypes('media', { mediaTypes: ['video', 'audio', 'audio'] })).toEqual(['video', 'audio'])
    expect(mediaCaptureTypes('media', { mediaTypes: [] })).toBeNull()
    expect(mediaCaptureTypes('media', { mediaTypes: ['audio', 'screen'] })).toBeNull()
    expect(mediaCaptureTypes('media', {})).toBeNull()
    expect(mediaCaptureTypes('notifications', { mediaTypes: ['audio'] })).toBeNull()
    expect(isAllowedRendererPermission('media')).toBe(false)
  })

  it('asks once per request in a session that provides consent, and denies on refusal or failure', async () => {
    const { session, handlers } = fakeSession()
    const answers = [true, false]
    const ask = vi.fn(async (_request: MediaCaptureRequest) => { const next = answers.shift(); if (next === undefined) throw new Error('dialog failed'); return next })
    configureRestrictedSession(session, new Set(), { requestMediaCapture: ask })
    const request = { mediaTypes: ['audio', 'video'], requestingUrl: 'courseware-editor://app/index.html' }
    expect(await decide(handlers.request!, 'media', request)).toBe(true)
    expect(await decide(handlers.request!, 'media', request)).toBe(false)
    expect(await decide(handlers.request!, 'media', request)).toBe(false)
    expect(ask).toHaveBeenCalledTimes(3)
    expect(ask.mock.calls[0][0]).toMatchObject({ contents, mediaTypes: ['audio', 'video'], requestingUrl: 'courseware-editor://app/index.html' })
    // Other permissions, checks, devices and screen capture are unchanged.
    expect(await decide(handlers.request!, 'notifications', {})).toBe(false)
    expect(await decide(handlers.request!, 'clipboard-sanitized-write', {})).toBe(true)
    expect(ask).toHaveBeenCalledTimes(3)
    expect(handlers.check!(contents, 'media')).toBe(false)
    expect(handlers.device!()).toBe(false)
    const streams = await new Promise<object>(resolve => handlers.display!({}, resolve))
    expect(streams).toEqual({})
  })

  it('denies devices without asking in a session that has no consent callback (headless admission)', async () => {
    const { session, handlers } = fakeSession()
    configureRestrictedSession(session, new Set())
    expect(await decide(handlers.request!, 'media', { mediaTypes: ['audio'] })).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  HOST_EVIDENCE_CONSOLE_PREFIX,
  HostEvidenceRecorder,
  type HostEvidenceRecord,
} from '../../src/player/HostEvidenceRecorder'

function recordFrom(message: string): HostEvidenceRecord {
  expect(message.startsWith(HOST_EVIDENCE_CONSOLE_PREFIX)).toBe(true)
  return JSON.parse(message.slice(HOST_EVIDENCE_CONSOLE_PREFIX.length)) as
    HostEvidenceRecord
}

describe('HostEvidenceRecorder', () => {
  it('publishes the session before assessment records and increments sequence', () => {
    const sink = vi.fn<(message: string) => void>()
    const recorder = new HostEvidenceRecorder({
      sink,
      sessionId: '49b9aa64-1733-4e6c-9d2f-6495f55ded62',
    })

    expect(recordFrom(sink.mock.calls[0]![0])).toEqual({
      schemaVersion: 1,
      kind: 'session-start',
      sessionId: '49b9aa64-1733-4e6c-9d2f-6495f55ded62',
      sequence: 0,
    })

    recorder.recordAssessment({
      scope: 'scene',
      sceneId: 'scene-one',
      request: {
        responseId: 'RESP-001',
        evaluatorId: 'EVAL-normalized-short-v1',
        input: '  Ａ  ',
        acceptedValues: ['a'],
      },
      result: {
        evaluatorId: 'EVAL-normalized-short-v1',
        normalizedInput: 'a',
        status: 'pass',
      },
    })
    recorder.recordAction({
      scope: 'scene',
      sceneId: 'scene-one',
      actId: 'ACT-001',
      responseId: 'RESP-001',
      actionKind: 'click',
      eventType: 'click',
    })
    recorder.recordAssessment({
      scope: 'global',
      request: {
        evaluatorId: 'EVAL-finite-choice-v1',
        input: 'B',
        acceptedValues: ['A'],
      },
      result: {
        evaluatorId: 'EVAL-finite-choice-v1',
        normalizedInput: 'B',
        status: 'fail',
      },
    })

    expect(recordFrom(sink.mock.calls[1]![0])).toEqual({
      schemaVersion: 1,
      kind: 'assessment-evaluated',
      sessionId: '49b9aa64-1733-4e6c-9d2f-6495f55ded62',
      sequence: 1,
      scope: 'scene',
      sceneId: 'scene-one',
      responseId: 'RESP-001',
      evaluatorId: 'EVAL-normalized-short-v1',
      input: '  Ａ  ',
      acceptedValues: ['a'],
      normalizedInput: 'a',
      status: 'pass',
    })
    expect(recordFrom(sink.mock.calls[2]![0])).toEqual({
      schemaVersion: 1,
      kind: 'action-recorded',
      sessionId: '49b9aa64-1733-4e6c-9d2f-6495f55ded62',
      sequence: 2,
      scope: 'scene',
      sceneId: 'scene-one',
      actId: 'ACT-001',
      responseId: 'RESP-001',
      actionKind: 'click',
      eventType: 'click',
    })
    expect(recordFrom(sink.mock.calls[3]![0])).toMatchObject({
      kind: 'assessment-evaluated',
      sequence: 3,
      scope: 'global',
      sceneId: null,
      responseId: null,
      status: 'fail',
    })
  })

  it('uses distinct cryptographically generated session ids by default', () => {
    const messagesA: string[] = []
    const messagesB: string[] = []
    new HostEvidenceRecorder({ sink: (message) => messagesA.push(message) })
    new HostEvidenceRecorder({ sink: (message) => messagesB.push(message) })
    const sessionA = recordFrom(messagesA[0]!)
    const sessionB = recordFrom(messagesB[0]!)
    expect(sessionA.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(sessionB.sessionId).not.toBe(sessionA.sessionId)
  })

  it('keeps using the captured JSON serializer after Runtime monkeypatching', () => {
    const messages: string[] = []
    const recorder = new HostEvidenceRecorder({
      sink: (message) => messages.push(message),
      sessionId: '49b9aa64-1733-4e6c-9d2f-6495f55ded62',
    })
    const originalStringify = JSON.stringify
    JSON.stringify = vi.fn(() => 'forged') as typeof JSON.stringify
    try {
      recorder.recordAction({
        scope: 'global',
        actId: 'ACT-001',
        actionKind: 'teacher-command',
        eventType: 'keydown',
      })
    } finally {
      JSON.stringify = originalStringify
    }
    expect(recordFrom(messages[1]!)).toMatchObject({
      kind: 'action-recorded',
      actId: 'ACT-001',
      sequence: 1,
    })
  })

  it('keeps using the console writer captured before Runtime source executes', async () => {
    const originalInfo = console.info
    const capturedWriter = vi.fn<(message: string) => void>()
    console.info = capturedWriter
    vi.resetModules()
    try {
      const isolated = await import('../../src/player/HostEvidenceRecorder')
      console.info = vi.fn()
      new isolated.HostEvidenceRecorder({
        sessionId: '49b9aa64-1733-4e6c-9d2f-6495f55ded62',
      })
      expect(capturedWriter).toHaveBeenCalledOnce()
      expect(capturedWriter.mock.calls[0]?.[0]).toContain('"kind":"session-start"')
    } finally {
      console.info = originalInfo
      vi.resetModules()
    }
  })
})

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { preserveRelFailureEvidence, relRecoveryDisposition, relTransportDiagnostics } from '../e2e/helpers/g20RelTransportDiagnostics'

const directories: string[] = []
const profile = () => { const path = mkdtempSync(join(tmpdir(), 'g20-rel-transport-')); directories.push(path); return path }
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

it('copies only allowlisted transport metadata and reports missing logs', () => {
  const path = profile()
  expect(relTransportDiagnostics(path)).toEqual({ state: 'missing', entries: [] })
  mkdirSync(join(path, 'diagnostics'))
  writeFileSync(join(path, 'diagnostics', 'editor-diagnostics.jsonl'), [
    JSON.stringify({ source: 'main', message: 'PRIVATE_PROMPT', details: { chatTransportPhase: 'body-read',
      chatTransportClass: 'TypeError', chatHttpResponseReceived: true, code: 'UND_ERR_SOCKET', httpStatus: 200,
      url: 'https://secret.invalid', credential: 'PRIVATE_KEY' } }),
    JSON.stringify({ source: 'renderer', details: { chatTransportPhase: 'fetch-before-headers',
      chatTransportClass: 'Error', chatHttpResponseReceived: false } }),
    JSON.stringify({ source: 'main', details: { chatTransportPhase: 'untrusted-phase',
      chatTransportClass: 'Error', chatHttpResponseReceived: false } }),
    'not-json',
  ].join('\n'))
  const result = relTransportDiagnostics(path)
  expect(result).toEqual({ state: 'readable', entries: [{ phase: 'body-read', errorClass: 'TypeError',
    httpResponseReceived: true, errorCode: 'UND_ERR_SOCKET', httpStatus: 200 }] })
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|secret\.invalid|credential|url/)
})

it('reports an unreadable diagnostic path without copying its contents', () => {
  const path = profile()
  mkdirSync(join(path, 'diagnostics', 'editor-diagnostics.jsonl'), { recursive: true })
  expect(relTransportDiagnostics(path)).toEqual({ state: 'read-failed', entries: [] })
})

it('preserves private evidence for uncertain and incomplete sent runs independently of paid resume', () => {
  expect(preserveRelFailureEvidence({ sent: true, status: 'partial' })).toBe(true)
  expect(preserveRelFailureEvidence({ sent: true, status: 'failed' })).toBe(true)
  expect(preserveRelFailureEvidence({ sent: true, status: 'interrupted' })).toBe(true)
  expect(preserveRelFailureEvidence({ sent: true, status: null })).toBe(true)
  expect(preserveRelFailureEvidence({ sent: true, status: 'completed', outcome: 'unknown' })).toBe(true)
  expect(preserveRelFailureEvidence({ sent: true, status: 'completed', postSendFailure: true })).toBe(true)
  expect(preserveRelFailureEvidence({ sent: true, status: 'completed' })).toBe(false)
  expect(preserveRelFailureEvidence({ sent: false, status: 'failed' })).toBe(false)
})

it('keeps a prior paid partial profile and manifest when a continuation fails before send', () => {
  expect(relRecoveryDisposition({ hasResumeManifest: true, sent: false, failureEvidence: false,
    liveApp: false, canResumePaid: false })).toEqual({ existingUnconsumedResume: true,
    consumeManifest: false, privateProfilePreserved: true })
  expect(relRecoveryDisposition({ hasResumeManifest: true, sent: true, failureEvidence: true,
    liveApp: false, canResumePaid: false })).toEqual({ existingUnconsumedResume: false,
    consumeManifest: true, privateProfilePreserved: true })
  const completedButPostSendAssertionFailed = preserveRelFailureEvidence({ sent: true, status: 'completed',
    postSendFailure: true })
  expect(relRecoveryDisposition({ hasResumeManifest: true, sent: true,
    failureEvidence: completedButPostSendAssertionFailed, liveApp: false, canResumePaid: false }))
    .toEqual({ existingUnconsumedResume: false, consumeManifest: true, privateProfilePreserved: true })
  expect(relRecoveryDisposition({ hasResumeManifest: false, sent: true, failureEvidence: false,
    liveApp: false, canResumePaid: false })).toEqual({ existingUnconsumedResume: false,
    consumeManifest: false, privateProfilePreserved: false })
})

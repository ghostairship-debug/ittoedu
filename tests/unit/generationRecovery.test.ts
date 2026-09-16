import { expect, it } from 'vitest'
import { generationRecovery, type GenerationFailure } from '../../src/shared/generationContract'

const diagnostic = (code: string): GenerationFailure['diagnostics'] => [{ code, message: 'fixture', path: [] }]

it('maps each known producer code family to an accurate next step instead of a blanket retry', () => {
  expect(generationRecovery(diagnostic('missing-candidate-delivery'))).toMatchObject({ action: 'repair-candidate', message: expect.stringContaining('candidate.json') })
  expect(generationRecovery(diagnostic('candidate-media-file'))).toMatchObject({ action: 'supply-resource' })
  expect(generationRecovery(diagnostic('unknown-tool'))).toMatchObject({ action: 'use-open-path' })
  expect(generationRecovery(diagnostic('invalid-target'))).toMatchObject({ action: 'repair-candidate' })
  expect(generationRecovery(diagnostic('dynamic-host-failed'))).toMatchObject({ action: 'repair-candidate', message: expect.stringContaining('准入') })
  expect(generationRecovery(diagnostic('dynamic-host-destroy-failed'))).toMatchObject({ action: 'repair-candidate' })
})

it('never reduces an opaque tool-failed to a retry or a source fallback suggestion', () => {
  expect(generationRecovery(diagnostic('tool-failed'))).toBeUndefined()
  expect(generationRecovery(diagnostic('some-unlisted-code'))).toBeUndefined()
})

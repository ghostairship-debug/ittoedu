// @vitest-environment node
import { expect, it } from 'vitest'
import { collectZeroModelPayloadCosts } from '../helpers/w7PayloadCost'

it('measures full-data versus module edits, image transport and repeated facts through their current owners', async () => {
  const report = await collectZeroModelPayloadCosts()
  expect(report.providerCalls).toBe(0)
  expect(report.module).toMatchObject({ sameCanonicalResult: true, sourceUntouched: true })
  expect(report.module.legs[0]!.readPages).toBeGreaterThan(1)
  expect(report.module.contentReduction.saved).toBeGreaterThan(0)
  expect(report.module.patchReduction.saved).toBeGreaterThan(report.module.contentReduction.saved)
  expect(report.image).toMatchObject({ originalRetainedExactly: true, derivativeApplied: true })
  expect(report.image.providerBody.saved).toBeGreaterThan(0)
  expect(report.hostFacts).toMatchObject({ beforeAppendedFragments: 21, afterAppendedFragments: 2,
    statusChangeRetained: true, distinctUnknownReceiptsRetained: true })
}, 30_000)

import { describe, expect, it } from 'vitest'
import { coursewareEvidenceManifestV1Schema } from '@/shared/coursewareEvidence'

const hash = 'a'.repeat(64)

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    experienceId: 'sample',
    experienceVersion: '1.0.0',
    scope: 'core-sample',
    generatedAt: '2026-08-07T00:00:00.000Z',
    generatedBy: 'automation',
    artifacts: [{ id: 'lesson', kind: 'glx', path: 'output/sample.glx', sha256: hash }],
    evidence: [{
      id: 'frame',
      kind: 'screenshot',
      path: 'output/frame.png',
      required: true,
      present: false,
    }],
    pipeline: {
      status: 'passed',
      reports: [{ id: 'health', path: 'output/health.json', passed: true }],
    },
    result: { status: 'pending', notes: [] },
    ...overrides,
  }
}

describe('CoursewareEvidenceManifestV1', () => {
  it('allows automation to record a pending visual gate', () => {
    expect(coursewareEvidenceManifestV1Schema.parse(manifest()).result.status).toBe('pending')
  })

  it('never allows automation to self-accept an outcome', () => {
    const result = coursewareEvidenceManifestV1Schema.safeParse(manifest({
      generatedBy: 'automation',
      evidence: [{
        id: 'frame',
        kind: 'screenshot',
        path: 'output/frame.png',
        required: true,
        present: true,
        sha256: hash,
      }],
      result: {
        status: 'accepted',
        reviewer: 'Automation',
        reviewedAt: '2026-08-07T00:00:00.000Z',
        notes: [],
      },
    }))
    expect(result.success).toBe(false)
  })

  it('requires evidence, passing reports, reviewer and time for acceptance', () => {
    const result = coursewareEvidenceManifestV1Schema.safeParse(manifest({
      generatedBy: 'human',
      result: { status: 'accepted', notes: [] },
    }))
    expect(result.success).toBe(false)
  })

  it('accepts a fully evidenced human review', () => {
    const result = coursewareEvidenceManifestV1Schema.safeParse(manifest({
      generatedBy: 'human',
      evidence: [{
        id: 'frame',
        kind: 'screenshot',
        path: 'output/frame.png',
        required: true,
        present: true,
        sha256: hash,
      }],
      result: {
        status: 'accepted',
        reviewer: 'Reviewer',
        reviewedAt: '2026-08-07T00:00:00.000Z',
        notes: [],
      },
    }))
    expect(result.success).toBe(true)
  })
})

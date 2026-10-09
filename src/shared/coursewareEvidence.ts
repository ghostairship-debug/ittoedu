import { z } from 'zod'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'sha256 must contain 64 hexadecimal characters')

export const coursewareEvidenceArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'glx',
    'standalone-html',
    'web-package',
    'pdf',
    'pptx',
    'component-package',
    'project-json',
    'report',
  ]),
  path: z.string().min(1),
  sha256: sha256Schema,
})

export const coursewareEvidenceItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['screenshot', 'recording', 'pptx-render', 'comparison']),
  path: z.string().min(1),
  required: z.boolean(),
  present: z.boolean(),
  sha256: sha256Schema.optional(),
  sceneId: z.string().min(1).optional(),
  stateId: z.string().min(1).optional(),
  notes: z.string().optional(),
})

export const coursewareEvidenceManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  experienceId: z.string().min(1),
  experienceVersion: z.string().min(1),
  scope: z.enum(['core-sample', 'full-course']),
  generatedAt: z.string().datetime(),
  generatedBy: z.enum(['automation', 'human']),
  artifacts: z.array(coursewareEvidenceArtifactSchema),
  evidence: z.array(coursewareEvidenceItemSchema),
  pipeline: z.object({
    status: z.enum(['passed', 'failed']),
    reports: z.array(z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      passed: z.boolean(),
    })),
  }),
  result: z.object({
    status: z.enum(['pending', 'reviewed', 'accepted', 'rejected']),
    reviewer: z.string().min(1).optional(),
    reviewedAt: z.string().datetime().optional(),
    notes: z.array(z.string()),
  }),
}).superRefine((manifest, context) => {
  if (manifest.generatedBy === 'automation' && manifest.result.status === 'accepted') {
    context.addIssue({
      code: 'custom',
      path: ['result', 'status'],
      message: 'automation cannot mark a courseware outcome as accepted',
    })
  }
  if (manifest.result.status !== 'accepted') return
  if (manifest.pipeline.status !== 'passed' || manifest.pipeline.reports.some((report) => !report.passed)) {
    context.addIssue({
      code: 'custom',
      path: ['pipeline'],
      message: 'accepted requires a fully passing pipeline',
    })
  }
  const missingEvidence = manifest.evidence.filter((item) => item.required && (!item.present || !item.sha256))
  if (missingEvidence.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['evidence'],
      message: `accepted requires every required evidence item: ${missingEvidence.map((item) => item.id).join(', ')}`,
    })
  }
  if (!manifest.result.reviewer || !manifest.result.reviewedAt) {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: 'accepted requires reviewer and reviewedAt',
    })
  }
})

export type CoursewareEvidenceManifestV1 = z.infer<typeof coursewareEvidenceManifestV1Schema>

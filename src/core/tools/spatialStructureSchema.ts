import { z } from 'zod'
import { spatialCameraPoseSchema, spatialPathDocumentSchema, spatialRelationDocumentSchema } from '../../shared/courseProjectSchema'

const path = spatialPathDocumentSchema.omit({ id: true })
const relation = spatialRelationDocumentSchema.omit({ id: true })
const name = z.string().trim().min(1).max(200)
export const spatialStructureToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('add-camera'), pose: spatialCameraPoseSchema, name: name.optional() }).strict(),
  z.object({ operation: z.literal('update-camera'), pose: spatialCameraPoseSchema.optional(), name: name.optional() }).strict(),
  z.object({ operation: z.literal('delete-camera') }).strict(),
  z.object({ operation: z.literal('set-home'), pose: spatialCameraPoseSchema }).strict(),
  z.object({ operation: z.literal('fit-world-content') }).strict(),
  z.object({ operation: z.literal('add-path'), path }).strict(),
  z.object({ operation: z.literal('update-path'), path: path.partial() }).strict(),
  z.object({ operation: z.literal('delete-path') }).strict(),
  z.object({ operation: z.literal('add-relation'), relation }).strict(),
  z.object({ operation: z.literal('update-relation'), relation: relation.partial() }).strict(),
  z.object({ operation: z.literal('delete-relation') }).strict(),
])


const target = z.string().min(1).max(200)
const operations = spatialStructureToolInputSchema.options
/** Entity references in path/relation fields are run-bound object handles, resolved by the host. */
export const spatialGatewayInputSchema = z.discriminatedUnion('operation', [
  operations[0].extend({ target }),
  operations[1].extend({ target }),
  operations[2].extend({ target }),
  operations[3].extend({ target }),
  operations[4].extend({ target, surface: target }),
  operations[5].extend({ target }),
  operations[6].extend({ target }),
  operations[7].extend({ target }),
  operations[8].extend({ target }),
  operations[9].extend({ target }),
  operations[10].extend({ target }),
])

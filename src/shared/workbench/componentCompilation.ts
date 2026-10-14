import { z } from 'zod'
import { ownRecordSchema } from '../ownRecordSchema'
import type { ComponentCompilationInput } from '../../core/components/compilation/types'

const files = ownRecordSchema(z.string(), z.string())
const binaryFiles = ownRecordSchema(z.string(), z.instanceof(Uint8Array)).optional()
const entryLanguage = z.enum(['javascript', 'typescript']).optional()
export const componentCompilationInputSchema: z.ZodType<ComponentCompilationInput> = z.object({
  entry: z.string().min(1), rootDefinitionId: z.string().min(1).optional(), entryLanguage, files, binaryFiles, moduleEntries: z.array(z.string()).optional(), moduleBindings: ownRecordSchema(z.string(), z.string()).optional(),
  htmlModuleBindings: ownRecordSchema(z.string(), z.string()).optional(),
  htmlModuleDocuments: z.array(z.object({ namespace: z.string(), entries: z.array(z.string()), bindings: ownRecordSchema(z.string(), z.string()) }).strict()).optional(),
  dependencies: ownRecordSchema(z.string(), z.object({ version: z.string(), entry: z.string().min(1), entryLanguage, files, binaryFiles,
    moduleBindings: ownRecordSchema(z.string(), z.string()).optional() }).strict()).optional(),
  options: z.object({ preserveModules: z.boolean().optional(), target: z.string().optional(), jsx: z.enum(['transform', 'automatic', 'preserve']).optional(),
    jsxImportSource: z.string().optional(), minify: z.boolean().optional(), sourceMap: z.boolean().optional() }).strict().optional(),
}).strict()

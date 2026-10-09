import { z } from 'zod'
import type { ComponentCompilationInput } from '../../core/components/compilation/types'

const files = z.record(z.string(), z.string())
const entryLanguage = z.enum(['javascript', 'typescript']).optional()
export const componentCompilationInputSchema: z.ZodType<ComponentCompilationInput> = z.object({
  entry: z.string().min(1), entryLanguage, files, moduleEntries: z.array(z.string()).optional(), moduleBindings: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.object({ version: z.string(), entry: z.string().min(1), entryLanguage, files,
    moduleBindings: z.record(z.string(), z.string()).optional() }).strict()).optional(),
  options: z.object({ preserveModules: z.boolean().optional(), target: z.string().optional(), jsx: z.enum(['transform', 'automatic', 'preserve']).optional(),
    jsxImportSource: z.string().optional(), minify: z.boolean().optional(), sourceMap: z.boolean().optional() }).strict().optional(),
}).strict()

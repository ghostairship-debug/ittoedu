import { z } from 'zod'

/** JSON dictionaries use own keys, including the literal key "__proto__".
 * Zod's record parser drops that key. Keep its key/value validation and wire
 * schema while constructing the result without Object.prototype setters.
 */
export function ownRecordSchema<Value extends z.ZodType>(key: z.ZodType<string>, value: Value) {
  const wire = z.record(key, value)
  const schema = z.custom<Record<string, z.input<Value>>>(input => z.core.util.isPlainObject(input))
    .transform((input, context): Record<string, z.output<Value>> => {
      const output: Record<string, z.output<Value>> = Object.create(null)
      for (const [name, entry] of Object.entries(input)) {
        const parsedKey = key.safeParse(name), parsedValue = value.safeParse(entry)
        if (!parsedKey.success) for (const issue of parsedKey.error.issues) context.addIssue({ ...issue, path: [name, ...issue.path] })
        if (!parsedValue.success) for (const issue of parsedValue.error.issues) context.addIssue({ ...issue, path: [name, ...issue.path] })
        if (parsedKey.success && parsedValue.success) Object.defineProperty(output, parsedKey.data, {
          value: parsedValue.data, enumerable: true, writable: true, configurable: true,
        })
      }
      return output
    })
  // Reuse Zod's record JSON-schema visitor, including recursive value refs.
  schema._zod.processJSONSchema = wire._zod.processJSONSchema
  return schema
}

export type OwnJsonValue = null | boolean | number | string | OwnJsonValue[] | { [key: string]: OwnJsonValue }
export const ownJsonValueSchema: z.ZodType<OwnJsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(ownJsonValueSchema), ownRecordSchema(z.string(), ownJsonValueSchema),
]))

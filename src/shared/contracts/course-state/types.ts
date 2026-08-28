export type CourseStateScalar = boolean | number | string | null

export type CourseStateDeclaration =
  | { key: string; valueType: 'boolean'; defaultValue: boolean }
  | { key: string; valueType: 'number'; defaultValue: number }
  | { key: string; valueType: 'string'; defaultValue: string }
  | { key: string; valueType: 'null'; defaultValue: null }

export type CourseStateCondition =
  | { type: 'exists'; key: string; exists: boolean }
  | {
      type: 'compare'
      key: string
      operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
      value: CourseStateScalar
    }

export function courseStateScalarType(
  value: CourseStateScalar,
): CourseStateDeclaration['valueType'] {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'string'
}

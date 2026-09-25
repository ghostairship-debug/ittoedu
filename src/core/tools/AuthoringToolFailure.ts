import type { AuthoringToolReceiptV1 } from '../../shared/authoringToolContract'
type Diagnostic = AuthoringToolReceiptV1['diagnostics'][number]

function diagnosticMessage(diagnostic: Diagnostic): string {
  if (!diagnostic.path.length) return diagnostic.message
  const path = diagnostic.path.reduce<string>((result, segment) => {
    const key = String(segment)
    return result + (/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(segment)}]`)
  }, '$')
  return `${path}: ${diagnostic.message}`
}

export class AuthoringToolFailure extends Error {
  constructor(readonly diagnostics: Diagnostic[], readonly behaviorEvidence?: AuthoringToolReceiptV1['behaviorEvidence']) { super(diagnostics.map(diagnosticMessage).join('\n')) }
}

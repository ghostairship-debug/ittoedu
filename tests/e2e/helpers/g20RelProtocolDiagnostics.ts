import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Copy only the four product-approved shape fields before deleting an isolated profile. */
export function relProtocolDiagnostics(profile: string) {
  const filename = join(profile, 'diagnostics', 'editor-diagnostics.jsonl')
  if (!existsSync(filename)) return []
  return readFileSync(filename, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try {
      const entry = JSON.parse(line), details = entry.details
      // DiagnosticPrivacy deliberately redacts arbitrary messages. Match only the
      // Main-only allowlisted protocol shape fields that survive that redaction.
      if (entry.source !== 'main' || !details || typeof details !== 'object'
        || details.chatToolCode !== 'unsupported-tool-type') return []
      return [{ code: details.chatToolCode ?? null, type: details.chatToolType ?? null,
        index: details.chatToolIndex ?? null, hasFunction: details.chatToolHasFunction ?? null }]
    } catch { return [] }
  })
}

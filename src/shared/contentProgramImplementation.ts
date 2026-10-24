import type { ComponentImplementation } from './contracts/component-platform/project'

/** Content programs own their internal scene; host placement and delivery routing remain separate decisions. */
export function isContentProgramImplementation(implementation: ComponentImplementation | null | undefined): boolean {
  return implementation?.kind === 'source'
    || implementation?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key)
}

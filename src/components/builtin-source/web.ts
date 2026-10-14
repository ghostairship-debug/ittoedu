import { mountWebContent } from '../web/contentRealmImplementation'

// An explicit Source declaration, inherited only when its author keeps this implementation.
// The runtime imports the module once before choosing the browser parser document.
export default { document: 'web' as const, mount(context: Parameters<typeof mountWebContent>[0] & { authoredDocument?: boolean }) {
  return mountWebContent(context, undefined, context.authoredDocument === true)
} }

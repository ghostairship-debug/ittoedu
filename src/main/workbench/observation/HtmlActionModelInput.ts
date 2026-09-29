import type { ModelChatMessage } from '../../../shared/workbench/modelProvider'
import type { HtmlActionObservation } from './HtmlActionService'

/** Delivers a captured HTML frame only after all receipts in that tool turn. */
export function htmlActionModelMessage(input: { toolCallId: string; target: string;
  toolName?: 'html.observe' | 'html.navigate' | 'html.click' | 'html.input';
  observation: HtmlActionObservation; bytes: Uint8Array }): ModelChatMessage {
  const { observation, bytes } = input
  if (observation.image.mimeType !== 'image/png' || bytes.byteLength !== observation.image.byteLength
    || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('HTML 观察图像资源与回执不符')
  const identity = observation.identity
  return { role: 'user', content: [
    { type: 'text', text: `工具 ${input.toolName ?? 'html.observe'} 后的真实画面。toolCallId=${input.toolCallId}; target=${input.target}; documentId=${identity.documentId}; epoch=${identity.epoch}; revision=${identity.revision}; loadId=${identity.loadId}; generation=${observation.generation}; pageUrl=${observation.currentUrl}; source=${observation.source}。请只据此画面和工具回执判断。` },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, detail: 'auto' } },
  ] }
}

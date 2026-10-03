import { z } from 'zod'
import { documentContentSchema } from '../document/content'
import type { NativeElementContent } from '../contracts/course-project-v9/types'
import type { CompositionNode, WebComposition } from './content'

/** Runtime schema is injected to keep author/published code representations separate. */
export function createWebCompositionSchema<TRuntime>(nativeContent: z.ZodType<NativeElementContent>, runtime: z.ZodType<TRuntime>): z.ZodType<WebComposition<TRuntime>> {
  const id = z.string().min(1).max(240)
  const node: z.ZodType<CompositionNode<TRuntime>> = z.lazy(() => z.discriminatedUnion('kind', [
    z.object({ id, kind: z.literal('element'), tagName: z.string().min(1), namespace: z.string().optional(), attributes: z.record(z.string(), z.string()), children: z.array(node) }).strict(),
    z.object({ id, kind: z.literal('text'), text: z.string() }).strict(),
    z.object({ id, kind: z.literal('comment'), text: z.string() }).strict(),
    z.object({ id, kind: z.literal('document'), content: documentContentSchema }).strict(),
    z.object({ id, kind: z.literal('native'), content: nativeContent }).strict(),
    z.object({ id, kind: z.literal('runtime'), runtime }).strict(),
  ]))
  return z.object({ doctype: z.string().optional(), root: node, assets: z.record(z.string(), z.object({ assetId: id }).strict()) }).strict().superRefine((content, ctx) => {
    const ids = new Set<string>()
    const visit = (current: CompositionNode<TRuntime>) => {
      if (ids.has(current.id)) ctx.addIssue({ code: 'custom', message: `组合内容对象身份重复：${current.id}` })
      ids.add(current.id)
      if (current.kind === 'element') current.children.forEach(visit)
    }
    visit(content.root)
  })
}

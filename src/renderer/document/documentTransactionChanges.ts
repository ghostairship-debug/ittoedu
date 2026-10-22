import type { Node as PMNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from 'prosemirror-transform'

function blockIdAt(doc: PMNode, position: number): string | undefined {
  const point = doc.resolve(position)
  for (let depth = point.depth; depth > 0; depth--) {
    const id = point.node(depth).attrs.id
    if (typeof id === 'string' && id) return id
  }
}

/** Only these steps leave all block, item, cell and formula identities intact.
 * Unknown/structural steps keep the existing full identity-repair path. */
export function editorTextChangeBlockIds(transactions: readonly Transaction[]): readonly string[] | undefined {
  const ids = new Set<string>()
  for (const transaction of transactions) {
    for (const [index, step] of transaction.steps.entries()) {
      const before = transaction.docs[index]
      if (step instanceof ReplaceStep) {
        const from = before.resolve(step.from), to = before.resolve(step.to)
        let plain = step.slice.openStart === 0 && step.slice.openEnd === 0
          && from.sameParent(to) && from.parent.isTextblock
        step.slice.content.forEach(node => { if (!node.isText && node.type.name !== 'hard_break') plain = false })
        if (plain) before.slice(step.from, step.to).content.forEach(node => { if (!node.isText && node.type.name !== 'hard_break') plain = false })
        if (!plain) return undefined
        const id = blockIdAt(before, step.from)
        if (!id) return undefined
        ids.add(id)
      } else if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
        before.nodesBetween(step.from, step.to, (node, position) => {
          if (!node.isTextblock) return
          const id = node.attrs.id ?? blockIdAt(before, position + 1)
          if (typeof id === 'string' && id) ids.add(id)
          return false
        })
      } else return undefined
    }
  }
  return [...ids]
}

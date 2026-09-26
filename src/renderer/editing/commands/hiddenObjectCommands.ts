import type { MenuCommand } from './CommandMenu'

/** The parts of a layer item that name it. */
interface NamedItem {
  readonly kind: string
  readonly label?: string
  readonly content?: { readonly nativeType?: string; readonly data?: unknown }
}

/** What a hidden object is called in the list: the start of its text, else its name. */
export function hiddenObjectName(item: NamedItem): string {
  const text = item.kind === 'native' && item.content?.nativeType === 'text' ? (item.content.data as { text?: unknown } | undefined)?.text : undefined
  return (typeof text === 'string' ? text.trim().slice(0, 16) : '') || item.label || '对象'
}

/**
 * Hidden objects stay findable on the canvas (M21): one 显示“…” per hidden object, and 全部显示 when there are several.
 * `show` makes the objects with those ids visible again.
 */
export function hiddenObjectCommands(hidden: readonly { id: string; name: string }[], show: (ids: readonly string[]) => void): MenuCommand[] {
  return [
    ...hidden.map((object): MenuCommand => ({ id: `show.${object.id}`, label: `显示“${object.name}”`, group: 'one', run: () => show([object.id]) })),
    ...(hidden.length > 1 ? [{ id: 'show.all', label: '全部显示', group: 'all', run: () => show(hidden.map(object => object.id)) }] : []),
  ]
}

import { forwardRef, useEffect, useId, useImperativeHandle, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface ChatComposerCommand {
  id: string
  label: string
  run(): void
}

export interface ChatMentionItem {
  name: string
  path: string
}

export interface ChatComposerMenusHandle {
  /** True when the open menu consumed the key; the composer must not also act on it. */
  handleKeyDown(event: KeyboardEvent): boolean
}

/** `/` lists wired commands; `@` lists real files in the current directory. Ordinary paths are not commands. */
export const ChatComposerMenus = forwardRef<ChatComposerMenusHandle, {
  value: string
  onChange(next: string): void
  commands: ChatComposerCommand[]
  mentions: ChatMentionItem[]
}>(function ChatComposerMenus({ value, onChange, commands, mentions }, ref) {
  // 命令只在输入开头触发，且命令 token 不含路径分隔符：旧写法 /(?:^|\s)\/([^\s]*)$/ 把空格后的
  // POSIX 绝对路径（「参考 /workspace/a.md」）当成命令查询，弹出「没有匹配的命令」挡住输入。
  // 命令 id 与 label 从不含 /，据此把路径排除在命令语义之外。
  const slash = value.match(/^\/([^\s/]*)$/)
  const at = value.match(/(?:^|\s)@([^\s]*)$/)
  const slashQuery = slash?.[1]?.toLowerCase() ?? ''
  const atQuery = at?.[1]?.toLowerCase() ?? ''
  const commandHits = slash
    ? commands.filter(item => item.label.toLowerCase().includes(slashQuery) || item.id.includes(slashQuery))
    : []
  const mentionHits = at
    ? mentions.filter(item => item.name.toLowerCase().includes(atQuery) || item.path.toLowerCase().includes(atQuery))
    : []
  const hits = slash ? commandHits : mentionHits
  const baseId = useId()
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  // 候选集变化就回到首项，并收回 Escape：与 VS Code 一致——Escape 只关掉当前这次候选，继续输入重新打开。
  useEffect(() => { setActive(0); setDismissed(false) }, [slashQuery, atQuery, commandHits.length, mentionHits.length])
  const activeIndex = Math.min(active, Math.max(hits.length - 1, 0))
  const open = !dismissed && hits.length > 0
  const accept = (index: number) => {
    if (slash) {
      const item = commandHits[index]
      if (!item) return
      onChange('')
      item.run()
      return
    }
    const item = mentionHits[index]
    if (item) onChange(`${value.replace(/@[^\s]*$/, '')}@${item.path} `)
  }
  useImperativeHandle(ref, () => ({
    handleKeyDown(event) {
      // 输入法组合期间的 Enter 与方向键属于选字，不是菜单操作。isComposing 是标准信号，
      // keyCode 229 覆盖组合态下不报 isComposing 的实现；漏掉这道守卫就会在选字时误选菜单项。
      if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : hits.length - 1
        setActive((activeIndex + step) % hits.length)
        event.preventDefault()
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        accept(activeIndex)
        event.preventDefault()
        return true
      }
      if (event.key === 'Escape') {
        setDismissed(true)
        event.preventDefault()
        return true
      }
      return false
    },
  }))
  if (!slash && !at) return null
  if (slash && !commandHits.length) {
    return <div className="chat-composer-menu" role="status">没有匹配的命令</div>
  }
  if (at && !mentionHits.length) {
    return <div className="chat-composer-menu" role="status">没有匹配的文件</div>
  }
  if (!open) return null
  const option = (key: string, index: number, label: string, title?: string) =>
    <button type="button" key={key} id={`${baseId}-${index}`} role="option" aria-selected={index === activeIndex} title={title}
      onMouseEnter={() => setActive(index)}
      onMouseDown={event => { event.preventDefault(); accept(index) }}>{label}</button>
  return <div className="chat-composer-menu" role="listbox" aria-label={slash ? '命令菜单' : '引用菜单'} aria-activedescendant={`${baseId}-${activeIndex}`}>
    {slash
      ? commandHits.map((item, index) => option(item.id, index, item.label))
      : mentionHits.map((item, index) => option(item.path, index, item.name, item.path))}
  </div>
})

export function useDirectoryMentions(directory: string | null | undefined): ChatMentionItem[] {
  const [items, setItems] = useState<ChatMentionItem[]>([])
  useEffect(() => {
    let live = true
    if (!directory || !window.desktopAPI?.lesson) { setItems([]); return }
    void window.desktopAPI.lesson({ operation: 'list-directory', directory }).then(result => {
      if (!live) return
      setItems((result.entries ?? []).filter(entry => entry.kind === 'file').map(entry => ({ name: entry.name, path: entry.path })))
    }).catch(() => { if (live) setItems([]) })
    return () => { live = false }
  }, [directory])
  return items
}

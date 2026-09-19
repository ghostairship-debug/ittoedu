import { useEffect, useState } from 'react'

export interface ChatComposerCommand {
  id: string
  label: string
  run(): void
}

export interface ChatMentionItem {
  name: string
  path: string
}

/** `/` lists wired commands; `@` lists real files in the current directory. Ordinary paths are not commands. */
export function ChatComposerMenus({
  value,
  onChange,
  commands,
  mentions,
}: {
  value: string
  onChange(next: string): void
  commands: ChatComposerCommand[]
  mentions: ChatMentionItem[]
}) {
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
  if (!slash && !at) return null
  if (slash && !commandHits.length) {
    return <div className="chat-composer-menu" role="status">没有匹配的命令</div>
  }
  if (at && !mentionHits.length) {
    return <div className="chat-composer-menu" role="status">没有匹配的文件</div>
  }
  return <div className="chat-composer-menu" role="listbox" aria-label={slash ? '命令菜单' : '引用菜单'}>
    {commandHits.map(item => <button type="button" key={item.id} role="option" onMouseDown={event => {
      event.preventDefault()
      onChange('')
      item.run()
    }}>{item.label}</button>)}
    {mentionHits.map(item => <button type="button" key={item.path} role="option" title={item.path} onMouseDown={event => {
      event.preventDefault()
      onChange(`${value.replace(/@[^\s]*$/, '')}@${item.path} `)
    }}>{item.name}</button>)}
  </div>
}

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

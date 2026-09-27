import { useState } from 'react'
import { QuickBarPopoverButton } from './SelectionQuickBar'
import { CommandMenuItems, moveMenuFocus, useContextMenu, type MenuCommand } from '../commands/CommandMenu'
import type { SlideLightCommand } from '../commands/slideLightCommands'

export interface SlideLightActionsProps {
  readonly commands: readonly SlideLightCommand[]
  readonly fontFamily: string | null
  readonly lineSpacing: number | null
  readonly backgroundColor: string | null
  readonly onRun: (command: SlideLightCommand) => Promise<void> | void
  readonly onError?: (message: string) => void
}

/** Shared command descriptors feed the bar and its More/context menu; this component owns no document state. */
export function slideLightMenuItems(commands: readonly SlideLightCommand[], run: (command: SlideLightCommand) => void): MenuCommand[] {
  return commands.map(command => ({ id: command.id, label: command.label, group: command.group,
    disabledReason: command.disabledReason, run: () => run(command) }))
}

function useSlideLightRunner(onRun: SlideLightActionsProps['onRun'], onError: SlideLightActionsProps['onError']) {
  const [error, setError] = useState<string | null>(null)
  const run = async (command: SlideLightCommand) => {
    if (command.disabledReason) return
    try { setError(null); await onRun(command) }
    catch (reason) { const message = reason instanceof Error ? reason.message : String(reason); setError(message); onError?.(message) }
  }
  return { error, run }
}

export function SlideLightActions({ commands, fontFamily, lineSpacing, backgroundColor, onRun, onError }: SlideLightActionsProps) {
  const { error, run } = useSlideLightRunner(onRun, onError)
  const popover = (label: string, kinds: readonly SlideLightCommand['kind'][], selected?: string | number | null) => {
    const items = commands.filter(command => kinds.includes(command.kind))
    if (!items.length) return null
    return <QuickBarPopoverButton label={label} text={label} popoverLabel={label} popupRole="menu">
      {close => <div className="command-menu" role="menu" aria-label={label} onKeyDown={moveMenuFocus}>
        <CommandMenuItems items={slideLightMenuItems(items.map(item => ({ ...item,
          label: item.value === selected ? `✓ ${item.label}` : item.label })), command => { close(); void run(command) })}
          onRun={command => command.run()} />
      </div>}
    </QuickBarPopoverButton>
  }
  return <>
    {popover('字体', ['font'], fontFamily)}
    {popover('行距', ['line-spacing'], lineSpacing)}
    {popover('页面背景', ['scene-background'], backgroundColor)}
    {error && <span role="alert" className="selection-quick-bar__label">{error}</span>}
  </>
}

/** Page actions can be opened from the toolbar without a selected layer item. */
export function SlideLightPageActions({ commands, backgroundColor, onRun, onError }: Pick<SlideLightActionsProps, 'commands' | 'backgroundColor' | 'onRun' | 'onError'>) {
  const menu = useContextMenu()
  const { error, run } = useSlideLightRunner(onRun, onError)
  const pageCommands = commands.filter(command => command.kind === 'scene-background' || command.kind === 'audio-import')
  if (!pageCommands.length) return null
  const items = slideLightMenuItems(pageCommands.map(command => ({ ...command,
    label: command.kind === 'scene-background' && command.value === backgroundColor ? `✓ ${command.label}` : command.label })),
    command => { void run(command) })
  return <span>
    <button type="button" aria-label="页面操作" aria-haspopup="menu" aria-expanded={menu.isOpen}
      onClick={event => { if (menu.isOpen) { menu.close(); return }
        const rect = event.currentTarget.getBoundingClientRect()
        menu.open({ x: rect.left, y: rect.bottom }, '页面操作', items) }}>页面操作</button>
    {menu.element}
    {error && <span role="alert">{error}</span>}
  </span>
}

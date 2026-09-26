import { useState } from 'react'
import { QuickBarPopoverButton } from './SelectionQuickBar'
import { CommandMenuItems, moveMenuFocus, type MenuCommand } from '../commands/CommandMenu'
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

export function SlideLightActions({ commands, fontFamily, lineSpacing, backgroundColor, onRun, onError }: SlideLightActionsProps) {
  const [error, setError] = useState<string | null>(null)
  const run = async (command: SlideLightCommand) => {
    try { setError(null); await onRun(command) }
    catch (reason) { const message = reason instanceof Error ? reason.message : String(reason); setError(message); onError?.(message) }
  }
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

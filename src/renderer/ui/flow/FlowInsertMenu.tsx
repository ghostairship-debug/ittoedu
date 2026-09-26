import type { ReactNode } from 'react'
import { FLOW_DOCUMENT_INSERT_COMMANDS, FLOW_PAPER_INSERT_COMMANDS, type FlowInsertCommand } from './flowInsertCommands'

export interface FlowInsertMenuProps {
  readonly onInsert: (command: FlowInsertCommand) => void
  readonly disabled?: boolean
  readonly children?: ReactNode
}

export function FlowInsertMenu({ onInsert, disabled = false, children }: FlowInsertMenuProps) {
  return <div className="flow-insert-menu" role="menu" aria-label="Flow 插入菜单">
    {children}
    <section aria-label="插入到正文"><h3>插入到正文</h3>
      {FLOW_DOCUMENT_INSERT_COMMANDS.map(command => <button key={`document-${command.kind}`} type="button" role="menuitem"
        data-flow-insert-destination="document" data-flow-insert-kind={command.kind} disabled={disabled}
        onClick={() => onInsert(command)}>{command.label}</button>)}
    </section>
    <section aria-label="放到纸面上"><h3>放到纸面上</h3>
      {FLOW_PAPER_INSERT_COMMANDS.map(command => <button key={`paper-${command.kind}`} type="button" role="menuitem"
        data-flow-insert-destination="paper" data-flow-insert-kind={command.kind} disabled={disabled}
        onClick={() => onInsert(command)}>{command.label}</button>)}
    </section>
  </div>
}

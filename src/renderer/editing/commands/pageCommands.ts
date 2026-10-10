import type { MenuCommand } from './CommandMenu'

export type NewPageKind = 'scene' | 'slide-page' | 'flow-page' | 'spatial-page'

export interface PageCardCommandInput {
  /** A Slide scene, or a whole page (Flow, Spatial or a Slide page with its scenes). */
  kind: 'scene' | 'page'
  /** Position among the cards it can be moved between, and their number. */
  index: number
  count: number
  /** Why this page cannot be deleted (the last one), or null. */
  deleteBlocked: string | null
}

export interface PageCardCommandPorts {
  addScene(): void
  duplicate(): void
  rename(): void
  remove(): void
  move(delta: -1 | 1): void
}

/**
 * Everything a page card offers (M21): one definition for the workbench page bar and the editor's page list, both
 * on right-click. A Slide card is one scene; Flow and Spatial cards are whole pages.
 */
export function pageCardCommands(input: PageCardCommandInput, ports: PageCardCommandPorts): MenuCommand[] {
  const scene = input.kind === 'scene'
  const noun = scene ? '场景' : '页面'
  return [
    ...(scene ? [{ id: 'page.new-scene', label: '新建场景', group: 'create', run: ports.addScene }] : []),
    { id: 'page.duplicate', label: '创建副本', group: 'create', run: ports.duplicate, disabledReason: scene ? null : '目前只能复制演示页的场景' },
    { id: 'page.rename', label: '重命名', group: 'edit', run: ports.rename },
    { id: 'page.move-before', label: '前移', group: 'order', run: () => ports.move(-1), disabledReason: input.index <= 0 ? `已是${scene ? '本页第一个场景' : '第一个页面'}` : null },
    { id: 'page.move-after', label: '后移', group: 'order', run: () => ports.move(1), disabledReason: input.index >= input.count - 1 ? `已是${scene ? '本页最后一个场景' : '最后一个页面'}` : null },
    { id: 'page.delete', label: `删除${noun}`, group: 'danger', danger: true, run: ports.remove, disabledReason: input.deleteBlocked },
  ]
}

/** The page bar's "+": a scene of the current Slide page first, then new pages of each kind. */
export function newPageCommands(add: (kind: NewPageKind) => void, sceneReason: string | null): MenuCommand[] {
  return [
    { id: 'page.add.scene', label: '新建场景', group: 'scene', run: () => add('scene'), disabledReason: sceneReason },
    { id: 'page.add.slide', label: '新建演示页', group: 'page', run: () => add('slide-page') },
    { id: 'page.add.flow', label: '新建流式布局', group: 'page', run: () => add('flow-page') },
    { id: 'page.add.spatial', label: '新建无限画布', group: 'page', run: () => add('spatial-page') },
  ]
}

export interface StateCommandPorts {
  add(): void
  duplicate(): void
  rename(): void
  remove(): void
}

/** A scene's state buttons: 母版 (the base the states override) can only gain a state; a named state can be copied, renamed or deleted. */
export function stateCommands(master: boolean, ports: StateCommandPorts): MenuCommand[] {
  const onlyNamed = master ? '母版不能复制、改名或删除' : null
  return [
    { id: 'state.add', label: '新建状态', group: 'create', run: ports.add },
    { id: 'state.duplicate', label: '创建副本', group: 'create', run: ports.duplicate, disabledReason: onlyNamed },
    { id: 'state.rename', label: '重命名', group: 'edit', run: ports.rename, disabledReason: onlyNamed },
    { id: 'state.delete', label: '删除状态', group: 'danger', danger: true, run: ports.remove, disabledReason: onlyNamed },
  ]
}

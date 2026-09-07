export interface ScenePickerScene {
  id: string
  name: string
  steps?: readonly { id: string; name: string }[]
}

export const SCENE_PICKER_OPEN_EVENT = 'player:scene-picker:open'
export const TEACHER_CONTROLLER_COLLAPSE_EVENT =
  'player:teacher-controller:collapse-change'

export interface TeacherControllerCollapseEvent {
  nodeId: string
  collapsed: boolean
}

export interface ScenePickerOverlayOptions {
  stage: HTMLElement
  scenes: readonly ScenePickerScene[]
  onSelect(sceneId: string, bypassNavigationGuards: boolean): void
  onClose?(): void
}

export interface ScenePickerOpenOptions {
  currentStepId?: string | null
  bypassNavigationGuards?: boolean
}

let scenePickerSequence = 0

function applyStyles(
  element: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
): void {
  Object.assign(element.style, styles)
}

/**
 * Accessible delivery-time scene directory. It intentionally lives outside
 * Phaser so long course lists retain native scrolling, focus and keyboard
 * semantics regardless of canvas scale.
 */
export class ScenePickerOverlay {
  private readonly document: Document
  private readonly layer: HTMLDivElement
  private readonly closeButton: HTMLButtonElement
  private readonly sceneButtons: HTMLButtonElement[] = []
  private readonly sceneIds: string[] = []
  private readonly stepButtons = new Map<string, HTMLButtonElement>()
  private readonly stepGroups = new Map<string, { list: HTMLElement; toggle: HTMLButtonElement }>()
  private readonly onSelect: (
    sceneId: string,
    bypassNavigationGuards: boolean,
  ) => void
  private readonly onClose: (() => void) | undefined
  private restoreFocusTo: HTMLElement | null = null
  private openValue = false
  private bypassNavigationGuards = false
  private destroyed = false

  constructor(options: ScenePickerOverlayOptions) {
    this.document = options.stage.ownerDocument
    this.onSelect = options.onSelect
    this.onClose = options.onClose

    const instanceId = ++scenePickerSequence
    const titleId = `lesson-scene-picker-title-${instanceId}`
    const descriptionId = `lesson-scene-picker-description-${instanceId}`

    const layer = this.document.createElement('div')
    layer.className = 'lesson-scene-picker-layer'
    layer.hidden = true
    applyStyles(layer, {
      position: 'absolute',
      inset: '0',
      zIndex: '30',
      display: 'none',
      placeItems: 'center',
      padding: 'clamp(12px, 3vw, 32px)',
      boxSizing: 'border-box',
      minWidth: '0',
      minHeight: '0',
      background: 'rgba(5, 10, 20, 0.58)',
      backdropFilter: 'blur(3px)',
      pointerEvents: 'auto',
    })

    const dialog = this.document.createElement('section')
    dialog.className = 'lesson-scene-picker'
    dialog.dataset.scenePicker = 'true'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', titleId)
    dialog.setAttribute('aria-describedby', descriptionId)
    applyStyles(dialog, {
      display: 'flex',
      width: 'min(600px, 100%)',
      maxWidth: '100%',
      boxSizing: 'border-box',
      maxHeight: 'min(82%, 640px)',
      minHeight: '0',
      flexDirection: 'column',
      overflow: 'hidden',
      border: '1px solid rgba(231, 184, 92, 0.72)',
      borderRadius: '18px',
      color: '#f8fafc',
      background: 'rgba(19, 28, 46, 0.985)',
      boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
      fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", sans-serif',
    })

    const header = this.document.createElement('header')
    applyStyles(header, {
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '12px',
      alignItems: 'start',
      padding: '20px 22px 16px',
      borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
    })

    const headingGroup = this.document.createElement('div')
    const title = this.document.createElement('h2')
    title.id = titleId
    title.textContent = '场景目录'
    applyStyles(title, {
      margin: '0',
      color: '#fff7df',
      fontSize: 'clamp(18px, 2.4vw, 24px)',
      lineHeight: '1.25',
    })
    const description = this.document.createElement('p')
    description.id = descriptionId
    description.textContent = `选择要跳转的场景，共 ${options.scenes.length} 个`
    applyStyles(description, {
      margin: '6px 0 0',
      color: '#b9c5d8',
      fontSize: '13px',
      lineHeight: '1.45',
    })
    headingGroup.append(title, description)

    const closeButton = this.document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'lesson-scene-picker__close'
    closeButton.setAttribute('aria-label', '关闭场景目录')
    closeButton.textContent = '×'
    applyStyles(closeButton, {
      width: '38px',
      height: '38px',
      padding: '0',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      borderRadius: '10px',
      color: '#f8fafc',
      background: 'rgba(255, 255, 255, 0.06)',
      font: '500 25px/1 Inter, sans-serif',
      cursor: 'pointer',
    })
    header.append(headingGroup, closeButton)

    const list = this.document.createElement('div')
    list.className = 'lesson-scene-picker__list'
    list.setAttribute('role', 'group')
    list.setAttribute('aria-label', '全部场景')
    applyStyles(list, {
      display: 'grid',
      minHeight: '0',
      gap: '8px',
      overflowX: 'hidden',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      padding: '14px 16px 18px',
      scrollbarGutter: 'stable',
    })

    options.scenes.forEach((scene, index) => {
      const button = this.document.createElement('button')
      button.type = 'button'
      button.className = 'lesson-scene-picker__item'
      button.dataset.sceneId = scene.id
      applyStyles(button, {
        display: 'grid',
        width: '100%',
        minHeight: '52px',
        gridTemplateColumns: '42px minmax(0, 1fr)',
        gap: '12px',
        alignItems: 'center',
        padding: '9px 14px',
        border: '1px solid rgba(148, 163, 184, 0.24)',
        borderRadius: '12px',
        color: '#edf2f8',
        background: 'rgba(255, 255, 255, 0.045)',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      })

      const number = this.document.createElement('span')
      number.setAttribute('aria-hidden', 'true')
      number.textContent = String(index + 1).padStart(2, '0')
      applyStyles(number, {
        color: '#e7b85c',
        fontSize: '12px',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.08em',
      })
      const name = this.document.createElement('span')
      name.textContent = scene.name
      applyStyles(name, {
        minWidth: '0',
        overflow: 'hidden',
        fontSize: '15px',
        fontWeight: '600',
        lineHeight: '1.35',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      })
      button.append(number, name)
      button.addEventListener('click', () => {
        if (this.destroyed) return
        const bypassNavigationGuards = this.bypassNavigationGuards
        this.close()
        this.onSelect(scene.id, bypassNavigationGuards)
      })
      if (scene.steps?.length) {
        const group = this.document.createElement('section')
        group.style.minWidth = '0'
        const row = this.document.createElement('div')
        applyStyles(row, { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '6px' })
        const toggle = this.document.createElement('button')
        toggle.type = 'button'
        toggle.dataset.sceneStepsToggle = scene.id
        toggle.setAttribute('aria-label', `${scene.name}的步骤`)
        toggle.setAttribute('aria-expanded', 'false')
        toggle.textContent = `步骤 ${scene.steps.length} ▾`
        applyStyles(toggle, { padding: '6px 10px', borderRadius: '10px',
          border: '1px solid rgba(148, 163, 184, 0.3)', background: 'transparent',
          color: '#b9c5d8', cursor: 'pointer', font: 'inherit', fontSize: '12px' })
        const steps = this.document.createElement('div')
        steps.id = `lesson-scene-picker-steps-${instanceId}-${index}`
        steps.dataset.sceneSteps = scene.id
        steps.setAttribute('role', 'group')
        steps.setAttribute('aria-label', `${scene.name}的步骤`)
        steps.hidden = true
        applyStyles(steps, { display: 'none', gap: '4px', padding: '6px 0 0 18px', minWidth: '0' })
        toggle.setAttribute('aria-controls', steps.id)
        this.stepGroups.set(scene.id, { list: steps, toggle })
        toggle.addEventListener('click', () => this.setStepsExpanded(scene.id, steps.hidden !== false))
        scene.steps.forEach((step, stepIndex) => {
          const stepButton = this.document.createElement('button')
          stepButton.type = 'button'
          stepButton.className = 'lesson-scene-picker__step'
          stepButton.dataset.stepId = step.id
          stepButton.textContent = `步骤 ${stepIndex + 1} · ${step.name}`
          applyStyles(stepButton, { width: '100%', minWidth: '0', minHeight: '36px',
            padding: '7px 12px', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '8px',
            color: '#dce5ef', background: 'rgba(255, 255, 255, 0.035)', textAlign: 'left',
            font: 'inherit', fontSize: '13px', overflowWrap: 'anywhere', cursor: 'pointer' })
          stepButton.addEventListener('click', () => {
            if (this.destroyed) return
            const bypass = this.bypassNavigationGuards
            this.close()
            this.onSelect(step.id, bypass)
          })
          this.stepButtons.set(step.id, stepButton)
          steps.append(stepButton)
        })
        row.append(button, toggle)
        group.append(row, steps)
        list.append(group)
      } else {
        list.append(button)
      }
      this.sceneButtons.push(button)
      this.sceneIds.push(scene.id)
    })

    dialog.append(header, list)
    layer.append(dialog)
    options.stage.append(layer)

    this.layer = layer
    this.closeButton = closeButton
    this.closeButton.addEventListener('click', this.handleCloseClick)
    this.layer.addEventListener('click', this.handleLayerClick)
    this.layer.addEventListener('keydown', this.handleKeyDown)
  }

  get isOpen(): boolean {
    return this.openValue
  }

  open(
    currentSceneId: string | null,
    options: ScenePickerOpenOptions = {},
  ): void {
    if (this.destroyed) return
    this.bypassNavigationGuards = options.bypassNavigationGuards ?? false
    if (!this.openValue) {
      this.restoreFocusTo = this.document.activeElement instanceof HTMLElement &&
        this.document.activeElement !== this.document.body
        ? this.document.activeElement
        : null
    }
    this.openValue = true
    this.layer.hidden = false
    this.layer.style.display = 'grid'

    this.sceneButtons.forEach((button, index) => {
      const current = this.sceneIds[index] === currentSceneId
      if (current) {
        button.setAttribute('aria-current', 'page')
        button.style.borderColor = 'rgba(231, 184, 92, 0.94)'
        button.style.background = 'rgba(231, 184, 92, 0.16)'
        button.style.boxShadow = 'inset 3px 0 0 #e7b85c'
      } else {
        button.removeAttribute('aria-current')
        button.style.borderColor = 'rgba(148, 163, 184, 0.24)'
        button.style.background = 'rgba(255, 255, 255, 0.045)'
        button.style.boxShadow = 'none'
      }
    })

    for (const sceneId of this.stepGroups.keys()) this.setStepsExpanded(sceneId, sceneId === currentSceneId)
    for (const [stepId, button] of this.stepButtons) {
      const current = stepId === options.currentStepId
      if (current) button.setAttribute('aria-current', 'step')
      else button.removeAttribute('aria-current')
      button.style.borderColor = current ? 'rgba(231, 184, 92, 0.94)' : 'rgba(148, 163, 184, 0.2)'
      button.style.background = current ? 'rgba(231, 184, 92, 0.16)' : 'rgba(255, 255, 255, 0.035)'
    }
    const currentStep = options.currentStepId ? this.stepButtons.get(options.currentStepId) : undefined
    const currentButton = this.sceneButtons.find(
      (button) => button.dataset.sceneId === currentSceneId,
    )
    const focusTarget = currentStep && !currentStep.closest('[hidden]')
      ? currentStep : currentButton ?? this.sceneButtons[0] ?? this.closeButton
    queueMicrotask(() => {
      if (!this.openValue || this.destroyed) return
      focusTarget.focus({ preventScroll: true })
      if (typeof focusTarget.scrollIntoView === 'function') {
        focusTarget.scrollIntoView({ block: 'nearest' })
      }
    })
  }

  close(restoreFocus = true): void {
    if (!this.openValue) {
      this.bypassNavigationGuards = false
      return
    }
    this.openValue = false
    this.bypassNavigationGuards = false
    this.layer.hidden = true
    this.layer.style.display = 'none'
    this.onClose?.()
    const restoreTarget = this.restoreFocusTo
    this.restoreFocusTo = null
    if (restoreFocus && restoreTarget?.isConnected) {
      queueMicrotask(() => restoreTarget.focus({ preventScroll: true }))
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.close(false)
    this.destroyed = true
    this.closeButton.removeEventListener('click', this.handleCloseClick)
    this.layer.removeEventListener('click', this.handleLayerClick)
    this.layer.removeEventListener('keydown', this.handleKeyDown)
    this.layer.remove()
  }

  private setStepsExpanded(sceneId: string, expanded: boolean): void {
    const group = this.stepGroups.get(sceneId)
    if (!group) return
    if (!expanded && group.list.contains(this.document.activeElement)) group.toggle.focus()
    group.list.hidden = !expanded
    group.list.style.display = expanded ? 'grid' : 'none'
    group.toggle.setAttribute('aria-expanded', String(expanded))
  }

  private visibleEntries(): HTMLButtonElement[] {
    return [...this.layer.querySelectorAll<HTMLButtonElement>('.lesson-scene-picker__list button')]
      .filter(button => !button.disabled && !button.closest('[hidden]'))
  }

  private readonly handleCloseClick = (): void => {
    this.close()
  }

  private readonly handleLayerClick = (event: MouseEvent): void => {
    if (event.target === this.layer) this.close()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.openValue) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
      return
    }

    const entries = this.visibleEntries()
    const focusables = [this.closeButton, ...entries]
    const activeIndex = focusables.indexOf(this.document.activeElement as HTMLButtonElement)
    if (event.key === 'Tab') {
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault()
        focusables.at(-1)?.focus()
      } else if (!event.shiftKey && activeIndex === focusables.length - 1) {
        event.preventDefault()
        focusables[0]?.focus()
      }
      return
    }

    let target: HTMLButtonElement | undefined
    const sceneIndex = entries.indexOf(
      this.document.activeElement as HTMLButtonElement,
    )
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      target = entries[(Math.max(-1, sceneIndex) + 1) % entries.length]
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      target = entries[
        sceneIndex <= 0 ? entries.length - 1 : sceneIndex - 1
      ]
    } else if (event.key === 'Home') {
      target = entries[0]
    } else if (event.key === 'End') {
      target = entries.at(-1)
    }

    if (
      event.key === 'ArrowDown' || event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' || event.key === 'ArrowLeft' ||
      event.key === 'Home' || event.key === 'End'
    ) {
      event.preventDefault()
      event.stopPropagation()
      target?.focus()
    }
  }
}

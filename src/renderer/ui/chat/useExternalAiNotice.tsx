import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  localAgentIdSchema,
  type LocalAgentId,
  type LocalAgentRequest,
  type LocalAgentResponse,
} from '../../../shared/localAgentContract'
import {
  EXTERNAL_AI_NOTICE_VERSION,
  externalAiNoticeStatusSchema,
} from '../../../shared/externalAiNotice'
import {
  aiWorkspaceIdentitySchema,
  type AiWorkspaceIdentity,
} from '../../../shared/workspaceIdentity'
import './external-ai-notice.css'

const STORAGE_TIMEOUT_MS = 10_000
const adapterLabels: Record<LocalAgentId, string> = {
  codex: 'Codex CLI',
  claude: 'Claude CLI',
  opencode: 'OpenCode CLI',
}

type ExternalAiNoticeApi = {
  localAgent(input: LocalAgentRequest): Promise<LocalAgentResponse>
}

export interface ExternalAiNoticeInput {
  scope: AiWorkspaceIdentity
  adapter: LocalAgentId
  references: string[]
}

interface FrozenNoticeInput {
  readonly scope: AiWorkspaceIdentity
  readonly adapter: LocalAgentId
  readonly references: readonly string[]
}

interface NoticeDialogState extends FrozenNoticeInput {
  mode: 'ensure' | 'review'
  confirming: boolean
  error: string
}

interface PendingEnsure {
  token: number
  input: FrozenNoticeInput
  resolve(result: boolean): void
}

export interface ExternalAiNoticeController {
  ensure(input: ExternalAiNoticeInput): Promise<boolean>
  review(input: ExternalAiNoticeInput): void
  cancel(): void
  dialog: ReactElement | null
}

function freezeInput(input: ExternalAiNoticeInput): FrozenNoticeInput {
  const scope = Object.freeze(aiWorkspaceIdentitySchema.parse(structuredClone(input.scope)))
  const adapter = localAgentIdSchema.parse(input.adapter)
  const references = Object.freeze(input.references.map(reference => `${reference}`))
  return Object.freeze({ scope, adapter, references })
}

function storageTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('本地确认存储响应超时')), STORAGE_TIMEOUT_MS)
    operation.then(
      value => { window.clearTimeout(timer); resolve(value) },
      error => { window.clearTimeout(timer); reject(error) },
    )
  })
}

function storageErrorMessage(error: unknown): string {
  const detail = error instanceof Error && error.message ? `：${error.message}` : ''
  return `本地确认没有保存${detail}。可以重试，或取消后保留当前输入。`
}

export function useExternalAiNotice(
  api: ExternalAiNoticeApi | undefined = typeof window === 'undefined' ? undefined : window.desktopAPI,
): ExternalAiNoticeController {
  const [dialogState, setDialogState] = useState<NoticeDialogState | null>(null)
  const pending = useRef<PendingEnsure | null>(null)
  const nextToken = useRef(0)
  const mounted = useRef(true)
  const dialogRef = useRef<HTMLElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<() => void>(() => undefined)
  const titleId = useId()
  const descriptionId = useId()

  const finish = useCallback((token: number, result: boolean) => {
    const current = pending.current
    if (!current || current.token !== token) return
    pending.current = null
    current.resolve(result)
    if (mounted.current) setDialogState(null)
  }, [])

  const cancel = useCallback(() => {
    const current = pending.current
    if (current) finish(current.token, false)
    else setDialogState(null)
  }, [finish])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const current = pending.current
      pending.current = null
      current?.resolve(false)
    }
  }, [])

  const ensure = useCallback((raw: ExternalAiNoticeInput): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false)
    const input = freezeInput(raw)
    const token = ++nextToken.current
    return new Promise<boolean>((resolve) => {
      pending.current = { token, input, resolve }
      if (mounted.current) setDialogState(null)
      void (async () => {
        try {
          if (!api) throw new Error('桌面服务不可用')
          const response = await storageTimeout(api.localAgent({ operation: 'external-notice', scope: input.scope }))
          const status = externalAiNoticeStatusSchema.parse(response.externalNotice)
          if (pending.current?.token !== token || !mounted.current) return
          if (status.confirmed && status.version === EXTERNAL_AI_NOTICE_VERSION) {
            finish(token, true)
            return
          }
          setDialogState({ ...input, mode: 'ensure', confirming: false, error: '' })
        } catch (error) {
          if (pending.current?.token !== token || !mounted.current) return
          setDialogState({ ...input, mode: 'ensure', confirming: false, error: storageErrorMessage(error) })
        }
      })()
    })
  }, [api, finish])

  const review = useCallback((raw: ExternalAiNoticeInput) => {
    if (pending.current) return
    const input = freezeInput(raw)
    setDialogState({ ...input, mode: 'review', confirming: false, error: '' })
  }, [])

  const confirm = useCallback(async () => {
    const current = pending.current
    if (!current || !api) {
      if (current && mounted.current) {
        setDialogState(state => state && state.mode === 'ensure'
          ? { ...state, confirming: false, error: storageErrorMessage(new Error('桌面服务不可用')) }
          : state)
      }
      return
    }
    const { token, input } = current
    setDialogState(state => state && state.mode === 'ensure' ? { ...state, confirming: true, error: '' } : state)
    try {
      const response = await storageTimeout(api.localAgent({ operation: 'external-notice', scope: input.scope, confirm: true }))
      const status = externalAiNoticeStatusSchema.parse(response.externalNotice)
      if (!status.confirmed) throw new Error('本地确认状态未更新')
      finish(token, true)
    } catch (error) {
      if (pending.current?.token !== token || !mounted.current) return
      setDialogState(state => state && state.mode === 'ensure'
        ? { ...state, confirming: false, error: storageErrorMessage(error) }
        : state)
    }
  }, [api, finish])

  closeRef.current = cancel
  const open = dialogState !== null
  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    queueMicrotask(() => initialFocusRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      event.stopPropagation()
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])]
      if (!focusable.length) return
      const first = focusable[0]!, last = focusable.at(-1)!
      if (!dialogRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  let dialog: ReactElement | null = null
  if (dialogState) {
    const reviewing = dialogState.mode === 'review'
    const label = adapterLabels[dialogState.adapter]
    const content = <div className="external-ai-notice__backdrop" role="presentation" onMouseDown={cancel}>
      <section ref={dialogRef} className="external-ai-notice" role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-describedby={descriptionId} onMouseDown={event => event.stopPropagation()}>
        <header>
          <p className="external-ai-notice__eyebrow">外部 AI 数据说明 · 版本 {EXTERNAL_AI_NOTICE_VERSION}</p>
          <h2 id={titleId}>{reviewing ? '查看外部处理说明' : '发送前了解外部处理范围'}</h2>
        </header>
        <div id={descriptionId} className="external-ai-notice__body">
          <p>你的消息和下列引用将交给 <strong>{label}</strong>。实际外部服务商由该 CLI 的原生配置决定；本应用无法确认当前具体 Provider，因此不会把某家公司写成确定接收方。</p>
          <section aria-label="本次实际引用">
            <h3>本次实际引用</h3>
            {dialogState.references.length
              ? <ul>{dialogState.references.map((reference, index) => <li key={`${index}:${reference}`}>{reference}</li>)}</ul>
              : <p className="external-ai-notice__empty">本次没有显式引用。</p>}
          </section>
          <p>文档和材料可以作为任务上下文交给原生 CLI；CLI 也可以按其已有的文件、终端、网络、工具和连接权限读取其他内容。最终哪些内容由外部处理、如何保留，取决于实际 Provider 的设置、条款和处理方式。</p>
          <p>使用文档 AI 编辑时，当前文档全文会作为上下文提供给 CLI；选区只限定本次允许修改的范围，不表示只向外部发送选中的文字。</p>
          <p>删除本应用中的对话、引用或本地确认记录，不保证删除 CLI 或外部 Provider 已保存的历史。</p>
          <p>这项说明按当前工作空间身份和说明版本记录一次。日常发送不会重复审批；作用域变化或说明版本升级时会再次显示。</p>
          {dialogState.error && <p className="external-ai-notice__error" role="alert">{dialogState.error}</p>}
        </div>
        <footer>
          {reviewing
            ? <button ref={initialFocusRef} type="button" onClick={cancel}>关闭</button>
            : <>
              <button ref={initialFocusRef} type="button" disabled={dialogState.confirming} onClick={cancel}>取消发送</button>
              <button type="button" className="external-ai-notice__primary" disabled={dialogState.confirming} onClick={() => void confirm()}>
                {dialogState.confirming ? '正在保存本地确认…' : dialogState.error ? '重试确认并继续' : '确认并继续'}
              </button>
            </>}
        </footer>
      </section>
    </div>
    dialog = createPortal(content, document.body)
  }

  return { ensure, review, cancel, dialog }
}

import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  localAgentIdSchema,
  type ExternalReferencesScope,
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
  /**
   * 权威清单来源。Main 用与真实发送同一个最终请求算出这份清单，所以这里传的是
   * 「本轮要发什么」的作用域，而不是渲染端自己算出的清单副本。缺省表示本轮尚未
   * 冻结引用目标；此时既不展示清单，也不声称清单为空。
   */
  referencesScope?: ExternalReferencesScope
  /** 渲染端已知、而 Main 清单不覆盖的附加事实（例如文档 AI 的允许修改范围）。 */
  additionalReferences?: readonly string[]
}

interface FrozenNoticeInput {
  readonly scope: AiWorkspaceIdentity
  readonly adapter: LocalAgentId
  readonly referencesScope?: ExternalReferencesScope
  readonly additionalReferences: readonly string[]
}

interface NoticeDialogState extends FrozenNoticeInput {
  mode: 'ensure' | 'review'
  confirming: boolean
  error: string
  references: readonly string[]
  referencesAvailable: boolean
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

/** A missing explanation is not a storage failure: it must never be reported as one. */
class ReferencesReadError extends Error {}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return value
}

function freezeInput(input: ExternalAiNoticeInput): FrozenNoticeInput {
  const scope = deepFreeze(aiWorkspaceIdentitySchema.parse(structuredClone(input.scope)))
  const adapter = localAgentIdSchema.parse(input.adapter)
  const referencesScope = input.referencesScope ? deepFreeze(structuredClone(input.referencesScope)) : undefined
  const additionalReferences = Object.freeze((input.additionalReferences ?? []).map(reference => `${reference}`))
  return Object.freeze({ scope, adapter, referencesScope, additionalReferences })
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

function referencesErrorMessage(error: unknown): string {
  const detail = error instanceof Error && error.message ? `：${error.message}` : ''
  return `没有读到本轮显式引用清单${detail}。为避免按不完整清单确认，这里不显示猜测内容；可以重试。`
}

function noticeErrorMessage(error: unknown): string {
  return error instanceof ReferencesReadError ? referencesErrorMessage(error) : storageErrorMessage(error)
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

  /** The explanation is read from Main, never reconstructed here: a renderer-side
   * copy would describe a payload other than the one the send actually attaches. */
  const readReferences = useCallback(async (input: FrozenNoticeInput): Promise<readonly string[]> => {
    if (!input.referencesScope) return []
    try {
      if (!api) throw new Error('桌面服务不可用')
      const response = await storageTimeout(api.localAgent({ operation: 'external-references', scope: input.referencesScope }))
      const references = response.externalReferences
      if (!references?.length) throw new Error('主进程没有返回本轮引用清单')
      return Object.freeze([...references, ...input.additionalReferences])
    } catch (error) {
      throw new ReferencesReadError(error instanceof Error ? error.message : String(error))
    }
  }, [api])

  const ensure = useCallback((raw: ExternalAiNoticeInput): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false)
    const input = freezeInput(raw)
    const token = ++nextToken.current
    return new Promise<boolean>((resolve) => {
      pending.current = { token, input, resolve }
      if (mounted.current) setDialogState(null)
      const fail = (error: unknown) => {
        if (pending.current?.token !== token || !mounted.current) return
        setDialogState({ ...input, mode: 'ensure', confirming: false, error: noticeErrorMessage(error), references: [], referencesAvailable: false })
      }
      const live = () => pending.current?.token === token && mounted.current
      void (async () => {
        let confirmed = false
        try {
          if (!api) throw new Error('桌面服务不可用')
          const response = await storageTimeout(api.localAgent({ operation: 'external-notice', scope: input.scope, adapter: input.adapter }))
          const status = externalAiNoticeStatusSchema.parse(response.externalNotice)
          confirmed = status.confirmed && status.version === EXTERNAL_AI_NOTICE_VERSION
        } catch (error) { fail(error); return }
        if (!live()) return
        if (confirmed) { finish(token, true); return }
        let references: readonly string[]
        try {
          references = await readReferences(input)
        } catch (error) { fail(error); return }
        if (!live()) return
        setDialogState({ ...input, mode: 'ensure', confirming: false, error: '', references, referencesAvailable: Boolean(input.referencesScope) })
      })()
    })
  }, [api, finish, readReferences])

  const review = useCallback((raw: ExternalAiNoticeInput) => {
    if (pending.current) return
    const input = freezeInput(raw)
    const same = (state: NoticeDialogState | null) => Boolean(state && state.mode === 'review' && state.scope === input.scope)
    setDialogState({ ...input, mode: 'review', confirming: false, error: '', references: [], referencesAvailable: false })
    void (async () => {
      let references: readonly string[] | undefined
      let error = ''
      try {
        references = await readReferences(input)
      } catch (cause) { error = referencesErrorMessage(cause) }
      if (!mounted.current) return
      setDialogState(state => same(state) ? { ...state!, references: references ?? [], referencesAvailable: Boolean(input.referencesScope) && !error, error } : state)
    })()
  }, [readReferences])

  const confirm = useCallback(async () => {
    const current = pending.current
    if (!current || !api) return
    const { token, input } = current
    setDialogState(state => state && state.mode === 'ensure' ? { ...state, confirming: true, error: '' } : state)
    try {
      // Re-read the authoritative list as part of confirming, so a recorded
      // confirmation always had a successfully read explanation behind it.
      await readReferences(input)
      const response = await storageTimeout(api.localAgent({ operation: 'external-notice', scope: input.scope, adapter: input.adapter, confirm: true }))
      const status = externalAiNoticeStatusSchema.parse(response.externalNotice)
      if (!status.confirmed) throw new Error('本地确认状态未更新')
    } catch (error) {
      if (pending.current?.token !== token || !mounted.current) return
      setDialogState(state => state && state.mode === 'ensure'
        ? { ...state, confirming: false, error: noticeErrorMessage(error) }
        : state)
      return
    }
    finish(token, true)
  }, [api, finish, readReferences])

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
          <section aria-label="本轮显式引用">
            <h3>本轮显式引用</h3>
            {!dialogState.referencesAvailable
              ? <p className="external-ai-notice__empty">{dialogState.referencesScope
                ? '尚未读到本轮引用清单；确认时会重新读取，读不到就不会记录确认。'
                : '本轮尚未冻结引用目标；发送前会显示这份清单。'}</p>
              : dialogState.references.length
                ? <ul>{dialogState.references.map((reference, index) => <li key={`${index}:${reference}`}>{reference}</li>)}</ul>
                : <p className="external-ai-notice__empty">本轮没有显式引用。</p>}
            <p>这份清单只列显式引用。为让任务连续执行，应用还会自动把上一阶段的宿主结果、组件修复输入等任务上下文文件放进 CLI 的工作目录，这些不逐条列出。</p>
          </section>
          <p>文档和材料可以作为任务上下文交给原生 CLI；CLI 也可以按其已有的文件、终端、网络、工具和连接权限读取其他内容。最终哪些内容由外部处理、如何保留，取决于实际 Provider 的设置、条款和处理方式。</p>
          <p>使用文档 AI 编辑时，当前文档全文会作为上下文提供给 CLI；选区只限定本次允许修改的范围，不表示只向外部发送选中的文字。</p>
          <p>删除本应用中的对话、引用或本地确认记录，不保证删除 CLI 或外部 Provider 已保存的历史。</p>
          <p>这项说明按当前工作空间身份、当前 CLI 和说明版本记录一次。日常发送不会重复审批；切换 CLI、作用域变化或说明版本升级时会再次显示。</p>
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

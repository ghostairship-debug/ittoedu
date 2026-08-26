import { useState, type ReactNode } from 'react'
import type {
  CourseNavigationGuard,
  CourseProjectDocument,
  CourseStateCondition,
  CourseStateDeclaration,
} from '../../shared/courseProjectTypes'
import type {
  CourseLogicAuthoringCommand,
  CourseLogicAuthoringResult,
} from '../course/courseLogicAuthoringCommands'

interface CourseLogicAuthoringPanelProps {
  project: CourseProjectDocument
  onCommand(command: CourseLogicAuthoringCommand): CourseLogicAuthoringResult
}

type CourseStateValueType = CourseStateDeclaration['valueType']
type CompareOperator = Extract<CourseStateCondition, { type: 'compare' }>['operator']

interface StateDraft {
  key: string
  valueType: CourseStateValueType
  booleanValue: boolean
  valueText: string
}

interface GuardConditionDraft {
  type: CourseStateCondition['type']
  key: string
  exists: boolean
  operator: CompareOperator
  valueText: string
}

interface GuardDraft {
  id: string
  allSources: boolean
  fromLocationIds: string[]
  toLocationIds: string[]
  match: CourseNavigationGuard['match']
  conditions: GuardConditionDraft[]
  message: string
}

interface LazyDetailsProps {
  summary: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}

function LazyDetails({
  summary,
  children,
  className,
  testId,
}: LazyDetailsProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <details className={className} data-testid={testId} open={expanded}>
      <summary
        onClick={(event) => {
          event.preventDefault()
          setExpanded((current) => !current)
        }}
      >
        {summary}
      </summary>
      {expanded ? children : null}
    </details>
  )
}

function nextStableId(prefix: string, used: ReadonlySet<string>): string {
  let index = 1
  while (used.has(`${prefix}_${index}`)) index += 1
  return `${prefix}_${index}`
}

function stateDraftFrom(
  declaration: CourseStateDeclaration | null,
  project: CourseProjectDocument,
): StateDraft {
  if (!declaration) {
    return {
      key: nextStableId(
        'state',
        new Set(project.courseState.map((state) => state.key)),
      ),
      valueType: 'boolean',
      booleanValue: false,
      valueText: '',
    }
  }
  return {
    key: declaration.key,
    valueType: declaration.valueType,
    booleanValue: declaration.valueType === 'boolean'
      ? declaration.defaultValue
      : false,
    valueText: declaration.valueType === 'number' || declaration.valueType === 'string'
      ? String(declaration.defaultValue)
      : '',
  }
}

function declarationFromDraft(
  draft: StateDraft,
): { ok: true; declaration: CourseStateDeclaration } | { ok: false; reason: string } {
  const key = draft.key.trim()
  if (!key) return { ok: false, reason: '状态键不能为空。' }
  if (draft.valueType === 'boolean') {
    return {
      ok: true,
      declaration: { key, valueType: 'boolean', defaultValue: draft.booleanValue },
    }
  }
  if (draft.valueType === 'number') {
    if (!draft.valueText.trim()) {
      return { ok: false, reason: '数值状态必须填写默认值。' }
    }
    const defaultValue = Number(draft.valueText)
    if (!Number.isFinite(defaultValue)) {
      return { ok: false, reason: '数值状态的默认值必须是有限数字。' }
    }
    return {
      ok: true,
      declaration: { key, valueType: 'number', defaultValue },
    }
  }
  if (draft.valueType === 'string') {
    return {
      ok: true,
      declaration: { key, valueType: 'string', defaultValue: draft.valueText },
    }
  }
  return { ok: true, declaration: { key, valueType: 'null', defaultValue: null } }
}

function defaultValueText(declaration: CourseStateDeclaration | undefined): string {
  if (!declaration || declaration.valueType === 'null') return ''
  return String(declaration.defaultValue)
}

function conditionDraftFrom(
  condition: CourseStateCondition,
): GuardConditionDraft {
  if (condition.type === 'exists') {
    return {
      type: 'exists',
      key: condition.key,
      exists: condition.exists,
      operator: 'eq',
      valueText: '',
    }
  }
  return {
    type: 'compare',
    key: condition.key,
    exists: true,
    operator: condition.operator,
    valueText: condition.value === null ? '' : String(condition.value),
  }
}

function newConditionDraft(
  project: CourseProjectDocument,
): GuardConditionDraft {
  return {
    type: 'exists',
    key: project.courseState[0]?.key ?? '',
    // A newly configured guard remains non-blocking until the author opts in.
    exists: false,
    operator: 'eq',
    valueText: '',
  }
}

function guardDraftFrom(
  guard: CourseNavigationGuard | null,
  project: CourseProjectDocument,
): GuardDraft {
  if (!guard) {
    return {
      id: nextStableId(
        'guard',
        new Set(project.navigationGuards.map((candidate) => candidate.id)),
      ),
      allSources: true,
      fromLocationIds: [],
      toLocationIds: project.locations[0] ? [project.locations[0].id] : [],
      match: 'all',
      conditions: [newConditionDraft(project)],
      message: '尚未满足进入条件',
    }
  }
  return {
    id: guard.id,
    allSources: guard.fromLocationIds === undefined,
    fromLocationIds: [...(guard.fromLocationIds ?? [])],
    toLocationIds: [...guard.toLocationIds],
    match: guard.match,
    conditions: guard.conditions.map(conditionDraftFrom),
    message: guard.message,
  }
}

function compareValueFromDraft(
  condition: GuardConditionDraft,
  declaration: CourseStateDeclaration,
): { ok: true; value: Extract<CourseStateCondition, { type: 'compare' }> } | {
  ok: false
  reason: string
} {
  const operator = condition.operator
  if (
    declaration.valueType !== 'number'
    && operator !== 'eq'
    && operator !== 'neq'
  ) {
    return { ok: false, reason: `状态“${declaration.key}”只有数值类型可使用大小比较。` }
  }
  if (declaration.valueType === 'number') {
    if (!condition.valueText.trim()) {
      return { ok: false, reason: `状态“${declaration.key}”的比较值不能为空。` }
    }
    const value = Number(condition.valueText)
    if (!Number.isFinite(value)) {
      return { ok: false, reason: `状态“${declaration.key}”的比较值必须是有限数字。` }
    }
    return { ok: true, value: { type: 'compare', key: declaration.key, operator, value } }
  }
  if (declaration.valueType === 'boolean') {
    return {
      ok: true,
      value: {
        type: 'compare',
        key: declaration.key,
        operator,
        value: condition.valueText === 'true',
      },
    }
  }
  if (declaration.valueType === 'null') {
    return {
      ok: true,
      value: { type: 'compare', key: declaration.key, operator, value: null },
    }
  }
  return {
    ok: true,
    value: {
      type: 'compare',
      key: declaration.key,
      operator,
      value: condition.valueText,
    },
  }
}

function guardFromDraft(
  draft: GuardDraft,
  project: CourseProjectDocument,
): { ok: true; guard: CourseNavigationGuard } | { ok: false; reason: string } {
  const id = draft.id.trim()
  if (!id) return { ok: false, reason: '守卫 ID 不能为空。' }
  if (!draft.allSources && draft.fromLocationIds.length === 0) {
    return { ok: false, reason: '请选择至少一个来源位置，或启用“所有来源位置”。' }
  }
  if (draft.toLocationIds.length === 0) {
    return { ok: false, reason: '导航守卫必须选择至少一个目标位置。' }
  }
  if (draft.conditions.length === 0) {
    return { ok: false, reason: '导航守卫必须保留至少一个条件。' }
  }
  const stateByKey = new Map(project.courseState.map((state) => [state.key, state]))
  const conditions: CourseStateCondition[] = []
  for (const condition of draft.conditions) {
    const declaration = stateByKey.get(condition.key)
    if (!declaration) {
      return { ok: false, reason: `条件引用的状态“${condition.key}”已失效。` }
    }
    if (condition.type === 'exists') {
      conditions.push({ type: 'exists', key: declaration.key, exists: condition.exists })
      continue
    }
    const compared = compareValueFromDraft(condition, declaration)
    if (!compared.ok) return compared
    conditions.push(compared.value)
  }
  const message = draft.message.trim()
  if (!message) return { ok: false, reason: '请填写导航被阻止时显示的提示。' }
  return {
    ok: true,
    guard: {
      id,
      effect: 'block',
      ...(draft.allSources ? {} : { fromLocationIds: [...draft.fromLocationIds] }),
      toLocationIds: [...draft.toLocationIds],
      match: draft.match,
      conditions,
      message,
    },
  }
}

function toggleId(
  current: readonly string[],
  id: string,
  checked: boolean,
): string[] {
  if (checked) return current.includes(id) ? [...current] : [...current, id]
  return current.filter((candidate) => candidate !== id)
}

interface StateDeclarationEditorProps {
  project: CourseProjectDocument
  declaration: CourseStateDeclaration | null
  onCommand(command: CourseLogicAuthoringCommand): CourseLogicAuthoringResult
  onDone?(): void
}

function StateDeclarationEditor({
  project,
  declaration,
  onCommand,
  onDone,
}: StateDeclarationEditorProps) {
  const [draft, setDraft] = useState(() => stateDraftFrom(declaration, project))
  const [feedback, setFeedback] = useState<string | null>(null)
  const editorName = declaration?.key ?? '新状态'

  const save = () => {
    const parsed = declarationFromDraft(draft)
    if (!parsed.ok) {
      setFeedback(parsed.reason)
      return
    }
    const command: CourseLogicAuthoringCommand = declaration
      ? {
          kind: 'course-state.update',
          projectId: project.id,
          baseRevision: project.revision,
          key: declaration.key,
          declaration: parsed.declaration,
        }
      : {
          kind: 'course-state.add',
          projectId: project.id,
          baseRevision: project.revision,
          declaration: parsed.declaration,
        }
    const result = onCommand(command)
    setFeedback(result.ok ? null : result.reason)
    if (result.ok) onDone?.()
  }

  const remove = () => {
    if (!declaration) return
    const result = onCommand({
      kind: 'course-state.delete',
      projectId: project.id,
      baseRevision: project.revision,
      key: declaration.key,
    })
    setFeedback(result.ok ? null : result.reason)
  }

  return (
    <div className="interaction-custom-rule" data-testid={`course-state-editor-${editorName}`}>
      <div className="form-field">
        <label htmlFor={`course-state-key-${editorName}`}>状态键</label>
        <input
          id={`course-state-key-${editorName}`}
          className="form-input"
          value={draft.key}
          onChange={(event) => setDraft((current) => ({
            ...current,
            key: event.target.value,
          }))}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`course-state-type-${editorName}`}>值类型</label>
        <select
          id={`course-state-type-${editorName}`}
          className="form-input"
          value={draft.valueType}
          onChange={(event) => {
            const valueType = event.target.value as CourseStateValueType
            setDraft((current) => ({
              ...current,
              valueType,
              booleanValue: false,
              valueText: valueType === 'number' ? '0' : '',
            }))
          }}
        >
          <option value="boolean">布尔</option>
          <option value="number">数字</option>
          <option value="string">文字</option>
          <option value="null">空值</option>
        </select>
      </div>
      {draft.valueType === 'boolean' ? (
        <div className="form-field">
          <label htmlFor={`course-state-default-${editorName}`}>默认值</label>
          <select
            id={`course-state-default-${editorName}`}
            className="form-input"
            value={draft.booleanValue ? 'true' : 'false'}
            onChange={(event) => setDraft((current) => ({
              ...current,
              booleanValue: event.target.value === 'true',
            }))}
          >
            <option value="false">否</option>
            <option value="true">是</option>
          </select>
        </div>
      ) : draft.valueType === 'number' || draft.valueType === 'string' ? (
        <div className="form-field">
          <label htmlFor={`course-state-default-${editorName}`}>默认值</label>
          <input
            id={`course-state-default-${editorName}`}
            className="form-input"
            type={draft.valueType === 'number' ? 'number' : 'text'}
            value={draft.valueText}
            onChange={(event) => setDraft((current) => ({
              ...current,
              valueText: event.target.value,
            }))}
          />
        </div>
      ) : (
        <p className="property-hint">空值状态的默认值固定为 null。</p>
      )}
      {feedback ? <p className="property-hint" role="alert">{feedback}</p> : null}
      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          aria-label={`保存课程状态 ${editorName}`}
          onClick={save}
        >
          保存状态
        </button>
        {declaration ? (
          <button
            type="button"
            className="secondary-button secondary-button--danger"
            aria-label={`删除课程状态 ${declaration.key}`}
            onClick={remove}
          >
            删除状态
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={onDone}>
            取消
          </button>
        )}
      </div>
    </div>
  )
}

interface NavigationGuardEditorProps {
  project: CourseProjectDocument
  guard: CourseNavigationGuard | null
  onCommand(command: CourseLogicAuthoringCommand): CourseLogicAuthoringResult
  onDone?(): void
}

function NavigationGuardEditor({
  project,
  guard,
  onCommand,
  onDone,
}: NavigationGuardEditorProps) {
  const [draft, setDraft] = useState(() => guardDraftFrom(guard, project))
  const [feedback, setFeedback] = useState<string | null>(null)
  const editorName = guard?.id ?? '新守卫'
  const stateByKey = new Map(project.courseState.map((state) => [state.key, state]))

  const updateCondition = (
    index: number,
    update: (condition: GuardConditionDraft) => GuardConditionDraft,
  ) => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, candidateIndex) => (
        candidateIndex === index ? update(condition) : condition
      )),
    }))
  }

  const save = () => {
    const parsed = guardFromDraft(draft, project)
    if (!parsed.ok) {
      setFeedback(parsed.reason)
      return
    }
    const command: CourseLogicAuthoringCommand = guard
      ? {
          kind: 'navigation-guard.update',
          projectId: project.id,
          baseRevision: project.revision,
          guardId: guard.id,
          guard: parsed.guard,
        }
      : {
          kind: 'navigation-guard.add',
          projectId: project.id,
          baseRevision: project.revision,
          guard: parsed.guard,
        }
    const result = onCommand(command)
    setFeedback(result.ok ? null : result.reason)
    if (result.ok) onDone?.()
  }

  const remove = () => {
    if (!guard) return
    const result = onCommand({
      kind: 'navigation-guard.delete',
      projectId: project.id,
      baseRevision: project.revision,
      guardId: guard.id,
    })
    setFeedback(result.ok ? null : result.reason)
  }

  return (
    <div className="interaction-custom-rule" data-testid={`navigation-guard-editor-${editorName}`}>
      <div className="form-field">
        <label htmlFor={`navigation-guard-id-${editorName}`}>守卫 ID</label>
        <input
          id={`navigation-guard-id-${editorName}`}
          className="form-input"
          value={draft.id}
          onChange={(event) => setDraft((current) => ({
            ...current,
            id: event.target.value,
          }))}
        />
      </div>

      <fieldset className="form-field">
        <legend>来源位置</legend>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={draft.allSources}
            onChange={(event) => setDraft((current) => ({
              ...current,
              allSources: event.target.checked,
            }))}
          />
          所有来源位置
        </label>
        {!draft.allSources ? project.locations.map((location) => (
          <label className="toggle-row" key={`from-${location.id}`}>
            <input
              type="checkbox"
              aria-label={`来源位置 ${location.label}`}
              checked={draft.fromLocationIds.includes(location.id)}
              onChange={(event) => setDraft((current) => ({
                ...current,
                fromLocationIds: toggleId(
                  current.fromLocationIds,
                  location.id,
                  event.target.checked,
                ),
              }))}
            />
            {location.label}
          </label>
        )) : null}
      </fieldset>

      <fieldset className="form-field">
        <legend>目标位置</legend>
        {project.locations.map((location) => (
          <label className="toggle-row" key={`to-${location.id}`}>
            <input
              type="checkbox"
              aria-label={`目标位置 ${location.label}`}
              checked={draft.toLocationIds.includes(location.id)}
              onChange={(event) => setDraft((current) => ({
                ...current,
                toLocationIds: toggleId(
                  current.toLocationIds,
                  location.id,
                  event.target.checked,
                ),
              }))}
            />
            {location.label}
          </label>
        ))}
      </fieldset>

      <div className="form-field">
        <label htmlFor={`navigation-guard-match-${editorName}`}>条件匹配方式</label>
        <select
          id={`navigation-guard-match-${editorName}`}
          className="form-input"
          value={draft.match}
          onChange={(event) => setDraft((current) => ({
            ...current,
            match: event.target.value as CourseNavigationGuard['match'],
          }))}
        >
          <option value="all">全部满足（all）</option>
          <option value="any">任一满足（any）</option>
        </select>
      </div>

      <div aria-label={`导航守卫 ${editorName} 条件`}>
        <h4>条件</h4>
        {draft.conditions.map((condition, index) => {
          const declaration = stateByKey.get(condition.key)
          const compareOperators: CompareOperator[] = declaration?.valueType === 'number'
            ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
            : ['eq', 'neq']
          return (
            <div className="interaction-custom-rule" key={`${index}:${condition.key}`}>
              <div className="form-field">
                <label htmlFor={`guard-${editorName}-condition-${index}-type`}>
                  条件 {index + 1} 类型
                </label>
                <select
                  id={`guard-${editorName}-condition-${index}-type`}
                  className="form-input"
                  value={condition.type}
                  onChange={(event) => updateCondition(index, (current) => ({
                    ...current,
                    type: event.target.value as CourseStateCondition['type'],
                    operator: 'eq',
                    valueText: defaultValueText(stateByKey.get(current.key)),
                  }))}
                >
                  <option value="exists">是否存在</option>
                  <option value="compare">比较值</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor={`guard-${editorName}-condition-${index}-key`}>
                  条件 {index + 1} 状态键
                </label>
                <select
                  id={`guard-${editorName}-condition-${index}-key`}
                  className="form-input"
                  value={condition.key}
                  onChange={(event) => updateCondition(index, (current) => {
                    const nextDeclaration = stateByKey.get(event.target.value)
                    return {
                      ...current,
                      key: event.target.value,
                      operator: nextDeclaration?.valueType === 'number'
                        ? current.operator
                        : current.operator === 'eq' || current.operator === 'neq'
                          ? current.operator
                          : 'eq',
                      valueText: defaultValueText(nextDeclaration),
                    }
                  })}
                >
                  {project.courseState.map((state) => (
                    <option key={state.key} value={state.key}>{state.key}</option>
                  ))}
                </select>
              </div>
              {condition.type === 'exists' ? (
                <div className="form-field">
                  <label htmlFor={`guard-${editorName}-condition-${index}-exists`}>
                    期望存在状态
                  </label>
                  <select
                    id={`guard-${editorName}-condition-${index}-exists`}
                    className="form-input"
                    value={condition.exists ? 'true' : 'false'}
                    onChange={(event) => updateCondition(index, (current) => ({
                      ...current,
                      exists: event.target.value === 'true',
                    }))}
                  >
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </div>
              ) : (
                <>
                  <div className="form-field">
                    <label htmlFor={`guard-${editorName}-condition-${index}-operator`}>
                      比较方式
                    </label>
                    <select
                      id={`guard-${editorName}-condition-${index}-operator`}
                      className="form-input"
                      value={condition.operator}
                      onChange={(event) => updateCondition(index, (current) => ({
                        ...current,
                        operator: event.target.value as CompareOperator,
                      }))}
                    >
                      {compareOperators.map((operator) => (
                        <option key={operator} value={operator}>{operator}</option>
                      ))}
                    </select>
                  </div>
                  {declaration?.valueType === 'boolean' ? (
                    <div className="form-field">
                      <label htmlFor={`guard-${editorName}-condition-${index}-value`}>
                        比较值
                      </label>
                      <select
                        id={`guard-${editorName}-condition-${index}-value`}
                        className="form-input"
                        value={condition.valueText === 'true' ? 'true' : 'false'}
                        onChange={(event) => updateCondition(index, (current) => ({
                          ...current,
                          valueText: event.target.value,
                        }))}
                      >
                        <option value="false">否</option>
                        <option value="true">是</option>
                      </select>
                    </div>
                  ) : declaration?.valueType === 'null' ? (
                    <p className="property-hint">比较值固定为 null。</p>
                  ) : (
                    <div className="form-field">
                      <label htmlFor={`guard-${editorName}-condition-${index}-value`}>
                        比较值
                      </label>
                      <input
                        id={`guard-${editorName}-condition-${index}-value`}
                        className="form-input"
                        type={declaration?.valueType === 'number' ? 'number' : 'text'}
                        value={condition.valueText}
                        onChange={(event) => updateCondition(index, (current) => ({
                          ...current,
                          valueText: event.target.value,
                        }))}
                      />
                    </div>
                  )}
                </>
              )}
              <button
                type="button"
                className="secondary-button secondary-button--danger"
                aria-label={`删除导航条件 ${index + 1}`}
                disabled={draft.conditions.length <= 1}
                onClick={() => setDraft((current) => ({
                  ...current,
                  conditions: current.conditions.filter((_, candidateIndex) => (
                    candidateIndex !== index
                  )),
                }))}
              >
                删除条件
              </button>
            </div>
          )
        })}
        <button
          type="button"
          className="secondary-button"
          disabled={project.courseState.length === 0 || draft.conditions.length >= 64}
          onClick={() => setDraft((current) => ({
            ...current,
            conditions: [...current.conditions, newConditionDraft(project)],
          }))}
        >
          添加条件
        </button>
      </div>

      <div className="form-field">
        <label htmlFor={`navigation-guard-message-${editorName}`}>阻止提示</label>
        <textarea
          id={`navigation-guard-message-${editorName}`}
          className="form-input"
          value={draft.message}
          onChange={(event) => setDraft((current) => ({
            ...current,
            message: event.target.value,
          }))}
        />
      </div>
      {project.courseState.length === 0 ? (
        <p className="property-hint" role="alert">请先声明至少一个课程状态，再创建守卫条件。</p>
      ) : null}
      {feedback ? <p className="property-hint" role="alert">{feedback}</p> : null}
      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          aria-label={`保存导航守卫 ${editorName}`}
          disabled={project.courseState.length === 0}
          onClick={save}
        >
          保存守卫
        </button>
        {guard ? (
          <button
            type="button"
            className="secondary-button secondary-button--danger"
            aria-label={`删除导航守卫 ${guard.id}`}
            onClick={remove}
          >
            删除守卫
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={onDone}>
            取消
          </button>
        )}
      </div>
    </div>
  )
}

export function CourseLogicAuthoringPanel({
  project,
  onCommand,
}: CourseLogicAuthoringPanelProps) {
  const [addingState, setAddingState] = useState(false)
  const [addingGuard, setAddingGuard] = useState(false)

  return (
    <LazyDetails
      className="property-section"
      testId="course-logic-authoring"
      summary={(
        <>
          专业：课程状态与导航守卫（{project.courseState.length} / {project.navigationGuards.length}）
        </>
      )}
    >
      <p className="property-hint">
        状态保存整课共享值；守卫在跨位置导航前按 all/any 检查条件，并显示明确提示。
      </p>

      <section aria-labelledby="course-state-authoring-title">
        <h3 className="property-title" id="course-state-authoring-title">课程状态声明</h3>
        {project.courseState.length === 0 ? (
          <p className="property-hint">尚未声明课程状态。</p>
        ) : project.courseState.map((declaration) => (
          <LazyDetails
            key={`${project.revision}:state:${declaration.key}`}
            summary={(
              <>
                {declaration.key} · {declaration.valueType} · 默认 {String(declaration.defaultValue)}
              </>
            )}
          >
            <StateDeclarationEditor
              project={project}
              declaration={declaration}
              onCommand={onCommand}
            />
          </LazyDetails>
        ))}
        {addingState ? (
          <StateDeclarationEditor
            key={`new-state:${project.revision}`}
            project={project}
            declaration={null}
            onCommand={onCommand}
            onDone={() => setAddingState(false)}
          />
        ) : (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setAddingState(true)}
          >
            新增课程状态
          </button>
        )}
      </section>

      <section aria-labelledby="navigation-guard-authoring-title">
        <h3 className="property-title" id="navigation-guard-authoring-title">导航守卫</h3>
        {project.navigationGuards.length === 0 ? (
          <p className="property-hint">尚未设置导航守卫。</p>
        ) : project.navigationGuards.map((guard) => (
          <LazyDetails
            key={`${project.revision}:guard:${guard.id}`}
            summary={(
              <>
                {guard.id} · {guard.match} · {guard.toLocationIds.length} 个目标
              </>
            )}
          >
            <NavigationGuardEditor
              project={project}
              guard={guard}
              onCommand={onCommand}
            />
          </LazyDetails>
        ))}
        {addingGuard ? (
          <NavigationGuardEditor
            key={`new-guard:${project.revision}`}
            project={project}
            guard={null}
            onCommand={onCommand}
            onDone={() => setAddingGuard(false)}
          />
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled={project.courseState.length === 0}
            title={project.courseState.length === 0
              ? '请先新增课程状态'
              : undefined}
            onClick={() => setAddingGuard(true)}
          >
            新增导航守卫
          </button>
        )}
      </section>
    </LazyDetails>
  )
}

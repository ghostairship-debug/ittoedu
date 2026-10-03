import { useEffect, useState } from 'react'
import type { ModelJsonObject } from '../../shared/workbench/modelProvider'
import { readModelThinkingBudget, withModelThinkingBudget, type ResolvedModelReasoning } from '../../shared/workbench/modelReasoning'

export function ModelThinkingBudgetControl({ parameters, resolved, disabled, onChange }: {
  parameters: ModelJsonObject; resolved: ResolvedModelReasoning; disabled?: boolean; onChange(parameters: ModelJsonObject): void
}) {
  const setting = readModelThinkingBudget(parameters, resolved)
  const savedTokens = setting?.type === 'enabled' ? setting.budgetTokens : undefined
  const [tokens, setTokens] = useState(savedTokens === undefined ? '' : String(savedTokens))
  useEffect(() => { setTokens(savedTokens === undefined ? '' : String(savedTokens)) }, [savedTokens])
  const parsed = Number(tokens), valid = tokens.trim() !== '' && Number.isSafeInteger(parsed) && parsed >= 1024
  return <div role="group" aria-label="思考 token 设置" style={{ display: 'grid', gap: 6 }}>
    <label style={{ display: 'grid', gap: 4 }}>思考 token 数<input aria-label="思考 token 数" type="number" min={1024} step={1} value={tokens}
      placeholder="填写思考 token 数" disabled={disabled} onChange={event => setTokens(event.target.value)} /></label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button type="button" disabled={disabled} aria-pressed={setting === undefined}
        onClick={() => onChange(withModelThinkingBudget(parameters, undefined, resolved))}>默认</button>
      <button type="button" disabled={disabled || !valid} aria-pressed={setting?.type === 'enabled'}
        onClick={() => onChange(withModelThinkingBudget(parameters, { type: 'enabled', budgetTokens: parsed }, resolved))}>开启思考</button>
      <button type="button" disabled={disabled} aria-pressed={setting?.type === 'disabled'}
        onClick={() => onChange(withModelThinkingBudget(parameters, { type: 'disabled' }, resolved))}>关闭思考</button>
    </div>
    <small>此型号通过思考 token 数控制推理；开启时至少 1024（模型 API 要求）。</small>
  </div>
}

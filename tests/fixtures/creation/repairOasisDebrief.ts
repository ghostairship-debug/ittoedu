/** Render the retained work's existing terminal records. No scores, physics,
 * causal deductions, or author-state writes are introduced by this repair.
 * Apply to the disposable work copy's intro.js through the normal module writer.
 */
export function repairOasisDebrief(original: string): string {
  const once = (text: string, before: string, after: string) => {
    if (text.split(before).length !== 2) throw new Error(`Expected one original Oasis debrief anchor: ${before.slice(0, 90)}`)
    return text.replace(before, after)
  }
  let source = once(original,
    '    if (result.feedback) extras.push(prettyValue(result.feedback));',
    `    if (result.feedback) extras.push(prettyValue(result.feedback));
    const returnMeasures = [
      { key: 'distance', label: '实际往返航程', unit: 'm' },
      { key: 'flightEnergy', label: '航行耗电', unit: '电量' },
      { key: 'operationEnergy', label: '复核、压载与回收耗电', unit: '电量' }
    ].filter(item => finite(result[item.key]));
    const integrityExplanation = typeof result.dataIntegrityExplanation === 'string' ? result.dataIntegrityExplanation.trim() : '';
    const returnLedger = Array.isArray(result.evidence?.ledger)
      ? result.evidence.ledger.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
    const shownNumber = value => finite(value) ? String(Number(value.toFixed(2))) : '—';
    const ledgerCell = (item, key) => \`<td data-ledger-field="\${key}" data-value="\${finite(item[key]) ? esc(String(item[key])) : ''}">\${shownNumber(item[key])}</td>\`;
    const terminalRecords = returnMeasures.length || integrityExplanation || returnLedger.length
      ? \`<div class="feedback stack" data-view="return-records"><h3>终幕带回的原始记录</h3>
        \${returnMeasures.length ? \`<ul class="evidence">\${returnMeasures.map(item => \`<li data-record="\${item.key}" data-value="\${esc(String(result[item.key]))}">\${item.label}：\${shownNumber(result[item.key])} \${item.unit}</li>\`).join('')}</ul>\` : ''}
        \${integrityExplanation ? \`<p data-record="dataIntegrityExplanation">\${esc(integrityExplanation)}</p>\` : ''}
        <p class="caption">同深度局部海图；距离以米计，电量与扰动为教学相对模型，不估算上浮段。明细显示值保留两位小数。</p>
        \${returnLedger.length ? \`<details data-view="return-ledger"><summary>展开逐项航行记录（\${returnLedger.length} 项）</summary><table class="table"><thead><tr><th scope="col">记录</th><th scope="col">耗电 / 电量</th><th scope="col">航程 / m</th><th scope="col">扰动指数</th></tr></thead><tbody>\${returnLedger.map(item => \`<tr data-record="ledger"><th scope="row">\${esc(typeof item.kind === 'string' ? item.kind : '未提供')}\${item.direction === 'outbound' ? ' · 入站' : item.direction === 'return' ? ' · 回航' : ''}</th>\${ledgerCell(item, 'energy')}\${ledgerCell(item, 'distance')}\${ledgerCell(item, 'disturbance')}</tr>\`).join('')}</tbody></table></details>\` : ''}
      </div>\` : '';`)
  source = once(source,
    '精确测量。</p>${extras.length ?',
    '精确测量。</p>${terminalRecords}${extras.length ?')
  source = once(source,
    " : '<p class=\"notice small\">终幕未附带逐项因果说明；上方只展示实际传入字段。",
    " : terminalRecords ? '' : '<p class=\"notice small\">当前复盘未收到可展示的逐项记录或说明；上方只展示实际传入字段。")
  return source
}

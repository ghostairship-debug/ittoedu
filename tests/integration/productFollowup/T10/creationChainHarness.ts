import type { ModelEvent, ModelProvider, ModelRequest } from '../../../../src/shared/workbench/modelProvider'
import type { ExecutionToolRecord } from '../../../../src/shared/workbench/execution'

/** Read real public receipts after a live run; this never chooses a model action. */
export function actualCreationEvidence(tools: readonly ExecutionToolRecord[], catalogs: string[][]) {
  const reads = tools.filter(tool => tool.result?.kind === 'read').map(tool => ({ name: tool.call.name,
    input: tool.call.input as Record<string, unknown>, data: tool.result!.kind === 'read' ? tool.result!.data as any : undefined }))
  const saved = reads.filter(tool => ['project.save', 'file.save'].includes(tool.name) && tool.data?.status === 'saved').at(-1)?.data
  const delivered = reads.filter(tool => tool.name === 'artifact.save' && tool.data?.status === 'written' && tool.data?.sourceKind === 'compute')
  return { catalogs, documentId: saved?.documentId as string | undefined, savedPath: saved?.path as string | undefined,
    computedFiles: { csv: delivered.find(tool => /\.csv$/i.test(tool.data.path))?.data.path as string | undefined,
      png: delivered.find(tool => /\.png$/i.test(tool.data.path))?.data.path as string | undefined },
    exports: reads.filter(tool => tool.name === 'document.export' && tool.data?.status === 'written' && tool.data?.documentId === saved?.documentId).map(tool => tool.data),
    results: reads.filter(tool => ['project.save', 'file.save', 'file.create', 'file.open', 'artifact.save', 'document.export'].includes(tool.name))
      .map(tool => ({ name: tool.name, result: { kind: 'read', data: tool.data } })),
  }
}

/** Only the text supplier is controlled. Every input below comes from the actual
 * product request or a returned public tool fact; no component IDs or handles
 * are supplied by the test to the model. */
export function creationChainProvider(humanLayout: (documentId: string, observedPath: string) => Promise<void>) {
  const evidence: { catalogs: string[][]; results: Array<{ name: string; result: any }>; computedRows?: string[][];
    documentId?: string; documentHandle?: string; pagePath?: string; chartPath?: string; exports: any[] } = {
    catalogs: [], results: [], exports: [],
  }
  let step = 0, job = '', material = '', csvPath = '', bodyPath = '', defaultPagePath = '', tablePaths: string[] = []
  let header: string[] = [], sourceRows: string[][] = [], outputRows: string[][] = [], lastName = ''
  function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
  const result = (request: ModelRequest): any => {
    const message = [...request.messages].reverse().find(value => value.role === 'tool')
    check(typeof message?.content === 'string', 'Actual public tool message is required')
    const value = JSON.parse(message.content as string)
    evidence.results.push({ name: lastName, result: value })
    check(value.kind !== 'error', `Public ${lastName} failed: ${JSON.stringify(value)}`)
    if (value.kind === 'document-operation') check(['applied', 'unchanged'].includes(value.result.status), `Formal write failed: ${JSON.stringify(value)}`)
    if (value.kind === 'read' && value.data?.commit) check(value.data.commit === 'committed', `Content was not committed: ${JSON.stringify(value)}`)
    return value.kind === 'read' ? value.data : value
  }
  const reply = (request: ModelRequest, name: string, args: unknown): ModelEvent => {
    check(request.tools?.some(tool => tool.name === name), `Actual default catalog lacks ${name}`)
    lastName = name
    const call = { id: `creation-${evidence.catalogs.length}`, name, argumentsText: JSON.stringify(args) }
    return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: `creation-response-${evidence.catalogs.length}`,
      actualModel: 'controlled-creation', nativeResponse: {}, finishReason: 'tool_calls', toolCalls: [call],
      assistant: { role: 'assistant', content: '', tool_calls: [{ id: call.id, type: 'function', function: { name, arguments: call.argumentsText } }] } }
  }
  const parseCSV = (value: string) => value.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.split(','))
  const parseContent = (data: any) => JSON.parse(data.content)
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const table = (rows: string[][]) => '<table><thead><tr>' + rows[0].map(value => `<th>${escape(value)}</th>`).join('')
    + '</tr></thead><tbody>' + rows.slice(1).map(row => '<tr>' + row.map(value => `<td>${escape(value)}</td>`).join('') + '</tr>').join('') + '</tbody></table>'
  const provider: ModelProvider = { async *stream(request) {
    evidence.catalogs.push(request.tools?.map(value => value.name) ?? [])
    const data = step ? result(request) : undefined
    switch (step) {
      case 0:
        check(JSON.stringify(request.messages).includes('班级平均分'), 'Product task context must reach the provider')
        step++; yield reply(request, 'file.list', {}); return
      case 1:
        check(data.entries.some((entry: any) => entry.name === '资料.md'), 'Discover real teacher material')
        csvPath = data.entries.find((entry: any) => entry.name.endsWith('.csv'))?.name
        check(csvPath && data.entries.some((entry: any) => entry.name === 'bell.png'), 'Discover CSV and existing bell through public file.list')
        step++; yield reply(request, 'file.read', { path: '资料.md' }); return
      case 2:
        material = data.text; check(typeof material === 'string' && material.includes('已有素材'), 'Read actual material text')
        step++; yield reply(request, 'file.read', { path: csvPath }); return
      case 3: {
        const csv = parseCSV(data.text); header = csv[0]; sourceRows = csv.slice(1)
        check(header.length === 2 && sourceRows.length > 0, 'Actual two-column CSV is required')
        // Header names and filename are taken from the public read. No host font
        // path is injected: the real local runtime owns its Chinese font setup.
        const code = [
          'import os, csv', 'from collections import defaultdict', 'import matplotlib.pyplot as plt',
          'groups = defaultdict(list)',
          `with open(os.path.join(os.environ['GUOLING_INPUT_DIR'], ${JSON.stringify(csvPath)}), encoding='utf-8-sig', newline='') as f:`,
          '    for row in csv.DictReader(f):',
          `        groups[row[${JSON.stringify(header[0])}]].append(float(row[${JSON.stringify(header[1])}]))`,
          'means = [(name, sum(values)/len(values)) for name, values in groups.items()]',
          'all_scores = [score for values in groups.values() for score in values]',
          'overall = sum(all_scores)/len(all_scores)',
          "with open(os.path.join(os.environ['GUOLING_OUTPUT_DIR'], '均分.csv'), 'w', encoding='utf-8', newline='') as f:",
          "    writer = csv.writer(f); writer.writerow(['班级','平均分'])",
          '    writer.writerows([(name, format(value,"g")) for name, value in means])',
          "    writer.writerow(['总体',format(overall,'g')])",
          'fig, ax = plt.subplots(figsize=(5,3), dpi=100)',
          'bars = ax.bar([name for name, value in means], [value for name, value in means], color=["#2563eb","#14b8a6"])',
          'ax.bar_label(bars, fmt="%g"); ax.axhline(overall, color="#ea580c", linestyle="--", label="总体平均分")',
          'ax.set(title="班级平均分", ylabel="平均分", ylim=(0,100)); ax.legend(); fig.tight_layout()',
          "fig.savefig(os.path.join(os.environ['GUOLING_OUTPUT_DIR'], '均分图.png')); plt.close(fig)",
          "print('班级均分', means, '总体', overall)",
        ].join('\n')
        step++; yield reply(request, 'compute.run', { code, sources: [csvPath], outputNames: ['均分.csv', '均分图.png'] }); return
      }
      case 4: {
        job = data.job || job; check(job, 'Use actual compute job receipt')
        check(['preparing', 'running', 'ready'].includes(data.status), `Real compute did not reach a usable state: ${JSON.stringify(data)}`)
        if (data.status !== 'ready') { yield reply(request, 'job.wait', { kind: 'compute', job, milliseconds: 30000 }); return }
        const ready = data.snapshot ?? data // job.wait returns the public job envelope.
        check(ready.artifacts?.some((artifact: any) => artifact.name === '均分.csv') && ready.artifacts?.some((artifact: any) => artifact.name === '均分图.png'), 'Ready means both actual artifacts exist')
        step++; yield reply(request, 'job.logs', { kind: 'compute', job }); return
      }
      case 5:
        step++; yield reply(request, 'artifact.save', { kind: 'compute', job, name: '均分.csv', destination: '均分.csv' }); return
      case 6:
        check(data.status === 'written', `CSV must really be saved: ${JSON.stringify(data)}`)
        step++; yield reply(request, 'artifact.save', { kind: 'compute', job, name: '均分图.png', destination: '均分图.png' }); return
      case 7:
        check(data.status === 'written', `Chinese PNG must really be saved: ${JSON.stringify(data)}`)
        step++; yield reply(request, 'file.read', { path: '均分.csv' }); return
      case 8:
        outputRows = parseCSV(data.text); evidence.computedRows = outputRows
        check(outputRows.length > 2, 'Create native contents from actual saved compute output')
        step++; yield reply(request, 'file.create', { name: '班级平均分.h5lesson', kind: 'course-v10' }); return
      case 9:
        check(data.target && data.documentId, `Real create must return a document handle: ${JSON.stringify(data)}`)
        evidence.documentHandle = data.target; evidence.documentId = data.documentId
        step++; yield reply(request, 'project.list', {}); return
      case 10:
        check(data.files.some((file: any) => file.path === 'pages'), 'Discover framework through actual projection')
        step++; yield reply(request, 'project.read', { path: 'pages' }); return
      case 11:
        defaultPagePath = parseContent(data).pages[0].path
        step++; yield reply(request, 'project.apply', { path: 'pages', intent: 'surface.add', kind: 'flow', title: '班级平均分' }); return
      case 12:
        step++; yield reply(request, 'project.read', { path: defaultPagePath }); return
      case 13:
        check(parseContent(data).objects.length === 0, 'Remove only the observed empty default page')
        step++; yield reply(request, 'project.apply', { path: defaultPagePath, intent: 'surface.remove' }); return
      case 14:
        step++; yield reply(request, 'project.list', {}); return
      case 15:
        bodyPath = data.files.find((file: any) => file.path.endsWith('.body.html'))?.path
        check(bodyPath, 'Flow editable HTML is publicly reachable')
        step++; yield reply(request, 'project.read', { path: bodyPath }); return
      case 16: {
        const classRows = outputRows.filter(row => row[0] !== '总体')
        const sum = sourceRows.reduce((value, row) => value + Number(row[1]), 0)
        const overall = outputRows.find(row => row[0] === '总体')?.[1]
        check(overall, 'Actual overall computed value is required')
        const source = '<h1>班级平均分</h1><p>来源：<a href="https://example.org/class-data">教师分数资料</a>，工作区分数.csv。每位学生权重相同。</p>'
          + `<p>总体平均分：\\((${sourceRows.map(row => row[1]).join('+')})/${sourceRows.length}=${overall}\\)。总分 ${sum}，共 ${sourceRows.length} 人。</p>`
          + table(outputRows) + '<h2>班级比较</h2>' + table(classRows)
        step++; yield reply(request, 'project.apply', { path: bodyPath, content: source }); return
      }
      case 17:
        step++; yield reply(request, 'project.list', {}); return
      case 18:
        tablePaths = data.files.filter((file: any) => /data\.json$/.test(file.path) && /表格/.test(file.path)).map((file: any) => file.path)
        check(tablePaths.length === 2, `Discover two editable native tables: ${JSON.stringify(data.files)}`)
        evidence.chartPath = tablePaths[1]
        // A real human uses the same public Gateway before the model freshly
        // reads its conversion input. This does not add information to ModelRequest.
        await humanLayout(evidence.documentId!, tablePaths[0])
        step++; yield reply(request, 'project.read', { path: evidence.chartPath }); return
      case 19:
        check(JSON.stringify(parseContent(data)).includes(outputRows[1][1]), 'Read actual native table data before converting')
        step++; yield reply(request, 'object.convert', { path: evidence.chartPath, to: 'chart', chartType: 'bar', title: '班级平均分比较', categoryColumn: 1, valueColumns: [2] }); return
      case 20:
        step++; yield reply(request, 'project.read', { path: 'pages' }); return
      case 21:
        evidence.pagePath = parseContent(data).pages.find((page: any) => page.kind === 'flow')?.path
        check(evidence.pagePath, 'Resolve current page after conversion; do not guess stale paths')
        step++; yield reply(request, 'project.read', { path: evidence.pagePath }); return
      case 22: {
        const answer = outputRows.slice(1).map(row => row.join(' ')).join('，')
        step++; yield reply(request, 'project.apply', { path: evidence.pagePath, intent: 'insert', content:
          `<section style="font:24px sans-serif;padding:16px;background:#eef6ff"><details><summary>显示平均分答案</summary><p>${escape(answer)}</p></details></section>` }); return
      }
      case 23:
        step++; yield reply(request, 'project.read', { path: evidence.pagePath }); return
      case 24:
        step++; yield reply(request, 'project.apply', { path: evidence.pagePath, from: '均分图.png', intent: 'insert' }); return
      case 25:
        step++; yield reply(request, 'project.read', { path: evidence.pagePath }); return
      case 26:
        step++; yield reply(request, 'project.apply', { path: evidence.pagePath, from: 'bell.png', intent: 'insert' }); return
      case 27:
        step++; yield reply(request, 'project.save', {}); return
      case 28:
        check(data.status === 'saved' && data.dirty === false && typeof data.path === 'string', `Formal lesson must be saved: ${JSON.stringify(data)}`)
        // Save the current course, including human layout, through its public
        // owner. Reopen the returned binding to obtain a current writable target;
        // a generic read after human changes correctly provides a read-only one.
        step++; yield reply(request, 'file.open', { path: data.path }); return
      case 29:
        check(data.target && data.documentId === evidence.documentId, `Public open must return the same saved document and a current target: ${JSON.stringify(data)}`)
        evidence.documentHandle = data.target
        step++; yield reply(request, 'document.export', { target: evidence.documentHandle, format: 'html-offline', destination: '班级平均分.html' }); return
      case 30:
        check(data.status === 'written', `Actual HTML export must be on disk: ${JSON.stringify(data)}`); evidence.exports.push(data)
        step++; yield reply(request, 'document.export', { target: evidence.documentHandle, format: 'docx', destination: '班级平均分.docx' }); return
      case 31:
        check(data.status === 'written', `Actual DOCX export must be on disk: ${JSON.stringify(data)}`); evidence.exports.push(data)
        step++; yield reply(request, 'task.finish', {}); return
      default: throw new Error(`Unexpected creation continuation ${step}: ${JSON.stringify(data)}`)
    }
  } }
  return { provider, evidence }
}

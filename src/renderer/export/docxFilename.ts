export function uniqueFlowDocxFilename(
  title: string,
  used: ReadonlySet<string> = new Set(),
): string {
  const base = (title.trim() || 'flow')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\.+$/g, '')
    .slice(0, 80) || 'flow'
  const taken = new Set([...used].map((name) => name.toLowerCase()))
  let name = `${base}.docx`
  let sequence = 2
  while (taken.has(name.toLowerCase())) {
    name = `${base}-${sequence}.docx`
    sequence += 1
  }
  return name
}

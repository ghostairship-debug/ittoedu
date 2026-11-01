/** The original module callers already use these IDs. Add only their existing
 * voice-asset aliases; do not invent arrival narration or a return ambience.
 * Apply to a disposable work copy through the ordinary module writer.
 */
export function repairOasisAudio(original: string): string {
  let source = original
  for (const [before, after] of [
    ["  discovery: 'voiceDiscovery', voiceDiscovery: 'voiceDiscovery',",
      "  discovery: 'voiceDiscovery', 'eco-discovery': 'voiceDiscovery', voiceDiscovery: 'voiceDiscovery',"],
    ["  return: 'voiceReturn', voiceReturn: 'voiceReturn'",
      "  return: 'voiceReturn', 'rescue-return': 'voiceReturn', voiceReturn: 'voiceReturn'"],
  ]) {
    if (source.split(before!).length !== 2) throw new Error(`Expected one original Oasis audio anchor: ${before}`)
    source = source.replace(before!, after!)
  }
  return source
}

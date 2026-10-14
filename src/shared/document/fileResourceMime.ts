/** File metadata shared by disk and canonical attachment readers. */
export function fileResourceMime(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf', zip: 'application/zip' }
  return Object.hasOwn(types, extension) ? types[extension] : 'application/octet-stream'
}

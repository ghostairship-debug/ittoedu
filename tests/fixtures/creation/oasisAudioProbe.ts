import type { FrameLocator } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Install with BrowserContext.addInitScript before loading the real delivery.
 * Observe real decode/start calls and fan out only nodes already connected to
 * the real destination. No author state, source, gain or decoder is substituted.
 */
export function installOasisAudioProbe() {
  const w = globalThis as any
  if (w.__oasisAudioProbe || typeof AudioNode === 'undefined') return
  const connect = AudioNode.prototype.connect, start = AudioBufferSourceNode.prototype.start
  const decode = BaseAudioContext.prototype.decodeAudioData
  const taps: any[] = [], voiceStarts: any[] = [], decodes: any[] = [], errors: string[] = []
  const voiceSources: { source: AudioBufferSourceNode; fact: any }[] = []
  const decoded = new WeakMap<AudioBuffer, any>()
  let current: any, sequence = 0
  const base64 = (bytes: Uint8Array) => {
    let text = ''
    for (let index = 0; index < bytes.length; index += 32768) text += String.fromCharCode(...bytes.subarray(index, index + 32768))
    return btoa(text)
  }
  const wave = (buffer: AudioBuffer) => {
    const channels = buffer.numberOfChannels, frames = buffer.length, bytes = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(bytes)
    const label = (at: number, text: string) => { for (let index = 0; index < text.length; index++) view.setUint8(at + index, text.charCodeAt(index)) }
    label(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true)
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true)
    const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel))
    let sum = 0, peak = 0, tailSum = 0, tailCount = 0, clipped = 0, offset = 44
    const tailStart = Math.max(0, frames - Math.round(buffer.sampleRate * 0.5))
    for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
      const value = data[channel]![frame]!, sample = Math.max(-1, Math.min(1, value))
      view.setInt16(offset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true); offset += 2
      sum += value * value; peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) >= 0.999) clipped++
      if (frame >= tailStart) { tailSum += value * value; tailCount++ }
    }
    return { wavBase64: base64(new Uint8Array(bytes)), pcm: { sampleRate: buffer.sampleRate, channels, frames,
      duration: buffer.duration, rms: Math.sqrt(sum / Math.max(1, frames * channels)), peak,
      tailRms: Math.sqrt(tailSum / Math.max(1, tailCount)), clippedSamples: clipped } }
  }
  const addRecorder = (tap: any, phase: any) => {
    if (phase.recorders.has(tap.id) || tap.context.state === 'closed') return
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type))
    if (!mimeType) throw new Error('Chromium has no WebM audio recorder')
    const recorder = new MediaRecorder(tap.stream.stream, { mimeType, audioBitsPerSecond: 128000 }), chunks: Blob[] = []
    const failures: string[] = [], began = performance.now()
    const done = new Promise<any>(resolve => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = event => failures.push(String((event as any).error ?? event.type))
      recorder.onstop = () => { void (async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType }), bytes = new Uint8Array(await blob.arrayBuffer())
        let audio: any = {}
        if (bytes.length) try {
          // Decode the actual recorded output for portable listening and energy
          // evidence. This never supplies data to the author's decoder or graph.
          const analysis = new OfflineAudioContext(1, 1, 48000)
          audio = wave(await analysis.decodeAudioData(bytes.buffer.slice(0)))
        } catch (error) { audio.decodeError = String(error) }
        resolve({ tapId: tap.id, mimeType: recorder.mimeType, bytes: bytes.length,
          began, ended: performance.now(), failures, webmBase64: base64(bytes), ...audio })
      })().catch(error => resolve({ tapId: tap.id, failures: [String(error)], bytes: 0 })) }
    })
    phase.recorders.set(tap.id, { recorder, done }); recorder.start(200)
  }
  AudioNode.prototype.connect = function(this: AudioNode, destination: any, ...args: any[]): any {
    const result = Reflect.apply(connect, this, [destination, ...args])
    if (destination === this.context.destination && this.context instanceof AudioContext) try {
      let tap = taps.find(value => value.context === this.context)
      if (!tap) {
        const context = this.context as AudioContext, analyser = context.createAnalyser()
        analyser.fftSize = 2048
        tap = { id: ++sequence, context, analyser, stream: context.createMediaStreamDestination(), connections: new Set<AudioNode>() }
        taps.push(tap)
      }
      if (!tap.connections.has(this)) {
        tap.connections.add(this)
        Reflect.apply(connect, this, [tap.stream, args[0] ?? 0, 0])
        Reflect.apply(connect, this, [tap.analyser, args[0] ?? 0, 0])
      }
      if (current) addRecorder(tap, current)
    } catch (error) { errors.push(String(error)) }
    return result
  }
  BaseAudioContext.prototype.decodeAudioData = function(this: BaseAudioContext, ...args: Parameters<BaseAudioContext['decodeAudioData']>) {
    const result = Reflect.apply(decode, this, args) as Promise<AudioBuffer>
    if (this instanceof AudioContext) {
      const context = this, began = performance.now()
      void result.then(buffer => {
        const fact = { decodedAt: performance.now(), began, duration: buffer.duration, sampleRate: buffer.sampleRate,
          channels: buffer.numberOfChannels, contextState: context.state }
        decoded.set(buffer, fact); decodes.push(fact)
      }, error => decodes.push({ began, error: String(error) }))
    }
    return result
  }
  AudioBufferSourceNode.prototype.start = function(this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
    const result = Reflect.apply(start, this, args)
    const buffer = this.buffer && decoded.get(this.buffer)
    if (buffer) {
      const fact = { ...buffer, at: performance.now(), tapId: taps.find(value => value.context === this.context)?.id,
        when: args[0] ?? 0, effectiveWhen: Math.max(args[0] ?? 0, this.context.currentTime),
        offset: args[1] ?? 0, requestedDuration: args[2], loop: this.loop, endedAt: null as number | null }
      voiceStarts.push(fact); voiceSources.push({ source: this, fact })
      this.addEventListener('ended', () => { fact.endedAt = performance.now() }, { once: true })
    }
    return result
  }
  const snapshot = () => ({ voiceStarts: [...voiceStarts], decodes: [...decodes], errors: [...errors],
    // Read the real source/context clock and ended event. This is lifecycle
    // evidence, not an assertion that a human has listened to its output.
    voiceSources: voiceSources.map(({ source, fact }) => ({ ...fact, contextState: source.context.state,
      contextTime: source.context.currentTime, playbackRate: source.playbackRate.value, detune: source.detune.value })),
    contexts: taps.map(tap => ({ id: tap.id, state: tap.context.state, sampleRate: tap.context.sampleRate,
      destinationConnections: tap.connections.size,
      streamTracks: tap.stream.stream.getAudioTracks().map((track: MediaStreamTrack) => ({ readyState: track.readyState, muted: track.muted })) })) })
  w.__oasisAudioProbe = {
    snapshot,
    begin(name: string) {
      if (current) throw new Error('A real-audio clip is already recording')
      current = { name, began: performance.now(), voiceIndex: voiceStarts.length, recorders: new Map() }
      for (const tap of taps) addRecorder(tap, current)
      return { began: current.began, voiceIndex: current.voiceIndex }
    },
    async measure(milliseconds: number) {
      const until = performance.now() + milliseconds, points: any[] = []
      let sum = 0, samples = 0, peak = 0
      do {
        let pointSum = 0, pointSamples = 0, pointPeak = 0, activeContexts = 0
        for (const tap of taps) {
          // A closed/suspended analyser retains old samples; they are not live
          // output. Report that state explicitly, never present it as new PCM.
          if (tap.context.state !== 'running') continue
          activeContexts++
          const data = new Float32Array(tap.analyser.fftSize); tap.analyser.getFloatTimeDomainData(data)
          for (const value of data) { pointSum += value * value; pointSamples++; pointPeak = Math.max(pointPeak, Math.abs(value)) }
        }
        sum += pointSum; samples += pointSamples; peak = Math.max(peak, pointPeak)
        points.push({ at: performance.now(), activeContexts, rms: pointSamples ? Math.sqrt(pointSum / pointSamples) : null, peak: pointSamples ? pointPeak : null })
        await new Promise(resolve => setTimeout(resolve, 40))
      } while (performance.now() < until)
      return { rms: samples ? Math.sqrt(sum / samples) : null, peak: samples ? peak : null, samples,
        maxActiveContexts: Math.max(...points.map(point => point.activeContexts)), points }
    },
    async end() {
      const phase = current
      if (!phase) throw new Error('No real-audio clip is recording')
      current = undefined
      for (const { recorder } of phase.recorders.values()) if (recorder.state !== 'inactive') recorder.stop()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const recordings = await Promise.race([Promise.all([...phase.recorders.values()].map((item: any) => item.done)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MediaRecorder did not stop')), 8000) })])
        return { name: phase.name, began: phase.began, ended: performance.now(),
          voiceStarts: voiceStarts.slice(phase.voiceIndex), recordings, after: snapshot() }
      } finally { clearTimeout(timer) }
    },
  }
}

/** An ordinary UI action produces the sound; this helper only records its output. */
export async function recordOasisAudioClip(content: FrameLocator, directory: string, name: string,
  action: () => Promise<void>, options: { captureMs?: number; voiceWaitMs?: number; settleMs?: number } = {}) {
  await mkdir(directory, { recursive: true })
  const body = content.locator('body'), began = Date.now()
  const marker = await body.evaluate((_body, name) => {
    const probe = (window as any).__oasisAudioProbe
    if (!probe) throw new Error('Real audio probe was not installed in this content frame')
    return probe.begin(name)
  }, name)
  let actionError: unknown, metrics: any, raw: any
  try {
    await action()
    if (options.voiceWaitMs) {
      const deadline = Date.now() + options.voiceWaitMs
      while (Date.now() < deadline) {
        if (await body.evaluate((_body, index) => (window as any).__oasisAudioProbe.snapshot().voiceStarts.length > index, marker.voiceIndex)) break
        await new Promise(resolve => setTimeout(resolve, 40))
      }
    }
    if (options.settleMs) await new Promise(resolve => setTimeout(resolve, options.settleMs))
    metrics = await body.evaluate((_body, milliseconds) => (window as any).__oasisAudioProbe.measure(milliseconds),
      Math.max(500, (options.captureMs ?? 6000) - (Date.now() - began)))
  } catch (error) { actionError = error }
  finally { raw = await body.evaluate(() => (window as any).__oasisAudioProbe.end()) }
  const recordings = []
  for (const [index, recording] of raw.recordings.entries()) {
    const { webmBase64, wavBase64, ...metadata } = recording
    const webm = join(directory, `${name}-${index + 1}.webm`), wav = wavBase64 ? join(directory, `${name}-${index + 1}.wav`) : undefined
    if (webmBase64) await writeFile(webm, Buffer.from(webmBase64, 'base64'))
    if (wav) await writeFile(wav, Buffer.from(wavBase64, 'base64'))
    recordings.push({ ...metadata, webm: webmBase64 ? webm : undefined, wav })
  }
  const result = { ...raw, recordings, metrics, actionError: actionError ? String(actionError) : undefined,
    method: 'parallel tap of nodes already connected to the real AudioDestinationNode; actual MediaRecorder output; no replacement graph or decoder' }
  await writeFile(join(directory, `${name}.json`), JSON.stringify(result, null, 2))
  if (actionError) throw actionError
  return result
}

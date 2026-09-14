// Input artifact preparation only. Never invokes the editor or a paid AI.
// Run explicitly to replace these frozen source media in a new task-set version.
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  for (const [name, color] of [['motion.webm', '#dc2626'], ['motion-blue.webm', '#2563eb']]) {
    const bytes = await page.evaluate(async color => {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 180
      const context = canvas.getContext('2d')
      const stream = canvas.captureStream(10)
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 80_000 })
      const chunks = []
      const finished = new Promise(resolve => {
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
        recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))
      })
      recorder.start()
      for (let frame = 0; frame < 20; frame++) {
        context.fillStyle = color; context.fillRect(0, 0, 320, 180)
        context.fillStyle = '#ffffff'; context.fillRect(20 + frame * 12, 78, 24, 24)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      recorder.stop()
      stream.getTracks().forEach(track => track.stop())
      return finished
    }, color)
    await writeFile(fileURLToPath(new URL(`./materials/${name}`, import.meta.url)), Uint8Array.from(bytes))
    const decoded = await page.evaluate(async bytes => {
      const video = document.createElement('video')
      video.src = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'video/webm' }))
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('Video did not decode')) })
      return { width: video.videoWidth, height: video.videoHeight, readyState: video.readyState }
    }, bytes)
    console.log(JSON.stringify({ name, bytes: bytes.length, ...decoded }))
  }
} finally { await browser.close() }

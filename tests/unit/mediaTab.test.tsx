import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { courseAudioSettings } from '../../src/core/course/courseMediaEdits'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { MediaTab, formatMediaDuration, formatMediaSize } from '../../src/renderer/ui/MediaTab'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import type { AssetMeta } from '../../src/shared/contracts/media-v1'

// Decoding is a browser capability; the actual media owner and its Session are exercised below.
vi.mock('../../src/renderer/project/assetManager', async original => ({ ...await original<typeof import('../../src/renderer/project/assetManager')>(),
  readImageDimensions: async () => ({ width: 800, height: 600 }) }))

function fixture() {
  const project = createBlankCourseProjectV10('媒体库')
  const metas: AssetMeta[] = [{ id: 'rain', filename: 'rain.mp3', mimeType: 'audio/mpeg', kind: 'audio', path: 'assets/rain.mp3', byteLength: 2048, duration: 65 },
    { id: 'lesson', filename: 'lesson.mp4', mimeType: 'video/mp4', kind: 'video', path: 'assets/lesson.mp4', byteLength: 4096, duration: 125, width: 1920, height: 1080 },
    { id: 'diagram', filename: 'diagram.png', mimeType: 'image/png', kind: 'image', path: 'assets/diagram.png', byteLength: 1536, width: 800, height: 600 },
    { id: 'unused', filename: 'unused.png', mimeType: 'image/png', kind: 'image', path: 'assets/unused.png', byteLength: 3 }]
  project.assets = Object.fromEntries(metas.map(meta => [meta.id, meta]))
  project.media = { audio: { ...courseAudioSettings(project), sounds: { rain: { id: 'rain', name: '雨声', assetId: 'rain', channel: 'sfx', defaultVolume: 1, defaultLoop: false } } } }
  return { project, resources: { assets: Object.fromEntries(metas.map(meta => [meta.id, new Uint8Array(meta.byteLength).fill(3)])), components: {} } }
}
async function change(label: string, value: string) {
  await act(async () => { fireEvent.change(screen.getByLabelText(label), { target: { value } }) })
}
function previewUrls() {
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const create = vi.fn(() => 'blob:media-preview'), revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  return { create, revoke, restore() {
    if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor); else Reflect.deleteProperty(URL, 'createObjectURL')
    if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor); else Reflect.deleteProperty(URL, 'revokeObjectURL')
  } }
}

it('exposes import actions and persists every audio channel, ducking and sound setting through the live media owner while releasing previews', async () => {
  const f = fixture(), h = await createV10StoreHost(f.project, f.resources), previous = useEditorStore.getState(), urls = previewUrls()
  try {
    await previous.connectCourseDocuments(h.api)
    const onImportImage = vi.fn(), onImportAudio = vi.fn(), onImportVideo = vi.fn()
    const ui = render(<MediaTab onImportImage={onImportImage} onImportAudio={onImportAudio} onImportVideo={onImportVideo} />)
    for (const name of ['导入图片', '导入声音', '导入视频']) fireEvent.click(screen.getByRole('button', { name }))
    expect(onImportImage).toHaveBeenCalledOnce(); expect(onImportAudio).toHaveBeenCalledOnce(); expect(onImportVideo).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('试听“雨声”')).toHaveAttribute('src', 'blob:media-preview'); expect(urls.create).toHaveBeenCalledWith(expect.any(Blob))
    await act(async () => { fireEvent.click(screen.getByLabelText('成品默认静音')) })
    await change('主音量', '72')
    for (const [label, value] of [['背景音乐声道音量', '11'], ['旁白声道音量', '22'], ['音效声道音量', '33'], ['界面提示音声道音量', '44'], ['视频声道音量', '55'], ['压低后的背景音乐音量', '18']]) await change(label, value)
    await act(async () => { fireEvent.click(screen.getByLabelText('旁白播放时压低背景音乐')) })
    await waitFor(() => expect(h.model().project.media!.audio).toMatchObject({ defaultMuted: true, masterVolume: .72,
      channelVolumes: { music: .11, narration: .22, sfx: .33, ui: .44, video: .55 }, narrationDucking: { enabled: true, musicVolume: .18 } }))
    await act(async () => { await useEditorStore.getState().courseBridge.undo() })
    expect(h.model().project.media!.audio.narrationDucking.enabled).toBe(false)
    await act(async () => { await useEditorStore.getState().courseBridge.redo() })
    await change('重命名声音“雨声”', '檐下雨声')
    await act(async () => { fireEvent.blur(screen.getByLabelText('重命名声音“雨声”')) })
    await waitFor(() => expect(h.model().project.media!.audio.sounds.rain.name).toBe('檐下雨声'))
    await change('“檐下雨声”的声道', 'music'); await change('“檐下雨声”的默认音量', '35')
    await act(async () => { fireEvent.click(screen.getByLabelText('“檐下雨声”默认循环')) })
    await waitFor(() => expect(h.model().project.media!.audio.sounds.rain).toMatchObject({ name: '檐下雨声', channel: 'music', defaultVolume: .35, defaultLoop: true }))
    await act(async () => { fireEvent.click(screen.getByLabelText('删除声音“檐下雨声”')) })
    await waitFor(() => expect(h.model().project.media!.audio.sounds.rain).toBeUndefined())
    expect([...h.model().resources.assets.rain]).toEqual([...f.resources.assets.rain])
    ui.unmount(); expect(urls.revoke).toHaveBeenCalledWith('blob:media-preview')
    expect(formatMediaDuration(3661)).toBe('1:01:01'); expect(formatMediaDuration(undefined)).toBe('时长未知')
    expect(formatMediaSize(512)).toBe('512 B'); expect(formatMediaSize(1536)).toBe('1.5 KB')
  } finally { cleanup(); urls.restore(); useEditorStore.getState().courseBridge.dispose(); useEditorStore.setState(previous, true); h.bridge.dispose() }
})

it('reuses library image and video as fresh editable instances, deletes only unused resources and restores their bytes with undo', async () => {
  const f = fixture(), h = await createV10StoreHost(f.project, f.resources), previous = useEditorStore.getState(), urls = previewUrls()
  try {
    await previous.connectCourseDocuments(h.api); render(<MediaTab onImportAudio={vi.fn()} onImportVideo={vi.fn()} />)
    expect(screen.getByText(/02:05 · 4.0 KB · 1920 × 1080/)).toBeInTheDocument()
    expect(screen.getByText(/1.5 KB · 800 × 600/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '将图片“diagram.png”添加到画布' })) })
    await waitFor(() => expect(h.first.read().undoDepth).toBe(1))
    const imageId = useEditorStore.getState().courseBridge.read().selectedInstanceId!
    expect(h.model().project.instances[imageId]).toMatchObject({ data: { assetId: 'diagram', originalAssetId: 'diagram' }, frame: { width: 480, height: 360 } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '将视频“lesson.mp4”添加到画布' })) })
    await waitFor(() => expect(h.first.read().undoDepth).toBe(2))
    const videoId = useEditorStore.getState().courseBridge.read().selectedInstanceId!
    expect(videoId).not.toBe(imageId); expect(h.model().project.instances[videoId]).toMatchObject({ data: { assetId: 'lesson' }, frame: { width: 480, height: 270 } })
    await act(async () => { fireEvent.click(screen.getByLabelText('删除图片“diagram.png”')) })
    expect(h.first.read().undoDepth).toBe(2); expect([...h.model().resources.assets.diagram]).toEqual([...f.resources.assets.diagram])
    await act(async () => { fireEvent.click(screen.getByLabelText('删除图片“unused.png”')) })
    await waitFor(() => expect(h.model().project.assets.unused).toBeUndefined())
    expect(h.first.read().undoDepth).toBe(3); expect(h.model().resources.assets.unused).toBeUndefined()
    await act(async () => { await useEditorStore.getState().courseBridge.undo() })
    expect([...h.model().resources.assets.unused]).toEqual([...f.resources.assets.unused])
    const reopened = h.driver.load(h.driver.serialize(h.model()))
    if (reopened.kind !== 'course-v10') throw new Error('Expected a Course V10 archive')
    expect(reopened.project).toEqual(h.model().project)
    for (const id of Object.keys(f.resources.assets)) expect([...reopened.resources.assets[id]]).toEqual([...h.model().resources.assets[id]])
  } finally { cleanup(); urls.restore(); useEditorStore.getState().courseBridge.dispose(); useEditorStore.setState(previous, true); h.bridge.dispose() }
})

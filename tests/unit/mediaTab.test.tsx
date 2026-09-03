import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetMeta } from '@/shared/projectTypes'
import { useEditorStore,
  selectActiveCourseProjectDocument,
  selectActiveScene,
} from '@/renderer/store/editorStore'
import {
  formatMediaDuration,
  formatMediaSize,
  MediaTab,
} from '@/renderer/ui/MediaTab'

const audioAsset: AssetMeta = {
  id: 'asset_audio',
  filename: 'rain.mp3',
  mimeType: 'audio/mpeg',
  kind: 'audio',
  path: 'assets/asset_audio.mp3',
  byteLength: 2_048,
  duration: 65,
}

const videoAsset: AssetMeta = {
  id: 'asset_video',
  filename: 'lesson.mp4',
  mimeType: 'video/mp4',
  kind: 'video',
  path: 'assets/asset_video.mp4',
  byteLength: 3 * 1024 * 1024,
  duration: 125,
  width: 1920,
  height: 1080,
}

const imageAsset: AssetMeta = {
  id: 'asset_image',
  filename: 'diagram.png',
  mimeType: 'image/png',
  kind: 'image',
  path: 'assets/asset_image.png',
  byteLength: 1_536,
  width: 800,
  height: 600,
}

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
let createObjectUrl: ReturnType<typeof vi.fn>
let revokeObjectUrl: ReturnType<typeof vi.fn>

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  createObjectUrl = vi.fn(() => 'blob:audio-preview')
  revokeObjectUrl = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl,
  })
})

afterEach(() => {
  cleanup()
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  } else {
    Reflect.deleteProperty(URL, 'createObjectURL')
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  } else {
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  }
})

function seedAssets(): string {
  const bytes = (asset: AssetMeta, marker: number): Uint8Array => {
    const value = new Uint8Array(asset.byteLength)
    value.set([marker, marker + 1, marker + 2])
    return value
  }
  const soundId = useEditorStore.getState().importSound(
    audioAsset,
    bytes(audioAsset, 1),
    { name: '雨声', channel: 'sfx' },
  )
  useEditorStore.getState().importAsset(videoAsset, bytes(videoAsset, 4))
  useEditorStore.getState().importAsset(imageAsset, bytes(imageAsset, 7))
  return soundId
}

describe('MediaTab', () => {
  it('调用顶部声音和视频导入入口', () => {
    const onImportAudio = vi.fn()
    const onImportVideo = vi.fn()
    render(
      <MediaTab
        onImportAudio={onImportAudio}
        onImportVideo={onImportVideo}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '导入声音' }))
    fireEvent.click(screen.getByRole('button', { name: '导入视频' }))
    expect(onImportAudio).toHaveBeenCalledOnce()
    expect(onImportVideo).toHaveBeenCalledOnce()
  })

  it('编辑全局静音、主音量、五个声道和旁白压低设置，并支持撤销重做', () => {
    render(<MediaTab onImportAudio={vi.fn()} onImportVideo={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('成品默认静音'))
    fireEvent.change(screen.getByLabelText('主音量'), {
      target: { value: '72' },
    })
    const channelValues = {
      背景音乐声道音量: '11',
      旁白声道音量: '22',
      音效声道音量: '33',
      界面提示音声道音量: '44',
      视频声道音量: '55',
    }
    for (const [label, value] of Object.entries(channelValues)) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.change(screen.getByLabelText('压低后的背景音乐音量'), {
      target: { value: '18' },
    })
    fireEvent.click(screen.getByLabelText('旁白播放时压低背景音乐'))

    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.media.audio).toMatchObject({
      defaultMuted: true,
      masterVolume: 0.72,
      channelVolumes: {
        music: 0.11,
        narration: 0.22,
        sfx: 0.33,
        ui: 0.44,
        video: 0.55,
      },
      narrationDucking: {
        enabled: false,
        musicVolume: 0.18,
      },
    })

    useEditorStore.getState().undo()
    expect(
      selectActiveCourseProjectDocument(useEditorStore.getState())!.media.audio.narrationDucking.enabled,
    ).toBe(true)
    useEditorStore.getState().redo()
    expect(
      selectActiveCourseProjectDocument(useEditorStore.getState())!.media.audio.narrationDucking.enabled,
    ).toBe(false)
  })

  it('用临时 Blob URL 试听并编辑声音定义，卸载时释放 URL', () => {
    const soundId = seedAssets()
    const view = render(
      <MediaTab onImportAudio={vi.fn()} onImportVideo={vi.fn()} />,
    )

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(screen.getByLabelText('试听“雨声”')).toHaveAttribute(
      'src',
      'blob:audio-preview',
    )
    const nameInput = screen.getByLabelText('重命名声音“雨声”')
    fireEvent.change(nameInput, { target: { value: '檐下雨声' } })
    fireEvent.blur(nameInput)
    fireEvent.change(screen.getByLabelText('“檐下雨声”的声道'), {
      target: { value: 'music' },
    })
    fireEvent.change(screen.getByLabelText('“檐下雨声”的默认音量'), {
      target: { value: '35' },
    })
    fireEvent.click(screen.getByLabelText('“檐下雨声”默认循环'))

    expect(
      selectActiveCourseProjectDocument(useEditorStore.getState())!.media.audio.sounds[soundId],
    ).toMatchObject({
      name: '檐下雨声',
      channel: 'music',
      defaultVolume: 0.35,
      defaultLoop: true,
    })

    view.unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:audio-preview')
  })

  it('显示媒体元数据，把视频添加为画布元素，并删除未使用图片', () => {
    seedAssets()
    render(<MediaTab onImportAudio={vi.fn()} onImportVideo={vi.fn()} />)

    expect(screen.getByText('lesson.mp4')).toBeInTheDocument()
    expect(screen.getByText(/02:05 · 3\.0 MB · 1920 × 1080/)).toBeInTheDocument()
    expect(screen.getByText('diagram.png')).toBeInTheDocument()
    expect(screen.getByText(/1\.5 KB · 800 × 600/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: '将视频“lesson.mp4”添加到画布',
    }))
    const videoNode = selectActiveScene(useEditorStore.getState()).nodes.find(
      (node) => node.type === 'video',
    )
    expect(videoNode).toMatchObject({
      type: 'video',
      assetId: videoAsset.id,
      width: 1920,
      height: 1080,
    })

    fireEvent.click(screen.getByLabelText('删除图片“diagram.png”'))
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageAsset.id]).toBeUndefined()
    expect(useEditorStore.getState().assetFiles[imageAsset.id]).toBeUndefined()
  })

  it('可复用已导入图片，在当前场景创建新的可编辑图片元素', () => {
    seedAssets()
    render(<MediaTab onImportAudio={vi.fn()} onImportVideo={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', {
      name: '将图片“diagram.png”添加到画布',
    }))

    const imageNode = selectActiveScene(useEditorStore.getState()).nodes.find(
      (node) => node.type === 'image',
    )
    expect(imageNode).toMatchObject({
      type: 'image',
      assetId: imageAsset.id,
      width: 640,
      height: 480,
    })
  })

  it('删除声音定义，并在素材字节缺失时禁用视频添加', () => {
    const soundId = seedAssets()
    useEditorStore.setState((state) => {
      const sidecar = state.courseAssetSidecar
      const files = { ...(sidecar?.files ?? {}) }
      delete files[videoAsset.id]
      const assetFiles = { ...state.assetFiles }
      delete assetFiles[videoAsset.id]
      return {
        courseAssetSidecar: sidecar
          ? { ...sidecar, files }
          : sidecar,
        assetFiles,
      }
    })
    render(<MediaTab onImportAudio={vi.fn()} onImportVideo={vi.fn()} />)

    expect(screen.getByRole('button', {
      name: '将视频“lesson.mp4”添加到画布',
    })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('删除声音“雨声”'))
    expect(
      selectActiveCourseProjectDocument(useEditorStore.getState())!.media.audio.sounds[soundId],
    ).toBeUndefined()
  })
})

describe('media formatting', () => {
  it('格式化时长和文件大小', () => {
    expect(formatMediaDuration(3_661)).toBe('1:01:01')
    expect(formatMediaDuration(undefined)).toBe('时长未知')
    expect(formatMediaSize(512)).toBe('512 B')
    expect(formatMediaSize(1_536)).toBe('1.5 KB')
  })
})

import { constants as filesystemConstants } from 'node:fs'
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'

import sharp from 'sharp'

import type { MediaConfiguration } from '../../config/media.config'
import { MediaContentDeliveryService } from './media-content-delivery.service'
import type { MediaStorage } from './media-storage'
import {
  MEDIA_VARIANT_CONTENT_TYPE,
  MediaVariantService,
} from './media-variant.service'

const CHECKSUM = 'b'.repeat(64)
const IMAGE_KEY = 'assets/dev/product/2026/10/11111111-1111-4111-8111-111111111111.png'
const VIDEO_KEY = 'assets/dev/product/2026/10/22222222-2222-4222-8222-222222222222.mp4'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'qianshu-media-variant-spec-'))
  temporaryDirectories.push(directory)
  return directory
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map(directory =>
    rm(directory, { force: true, recursive: true })))
})

function createDelivery(chunks: readonly unknown[]) {
  const open = jest.fn().mockImplementation(() => ({
    contentLength: BigInt(chunks.length),
    modifiedAt: new Date('2026-10-08T00:00:00.000Z'),
    sizeBytes: BigInt(chunks.length),
    stream: Readable.from([...chunks]),
  }))
  return {
    delivery: new MediaContentDeliveryService(
      { open } as unknown as MediaStorage,
      'application',
    ),
    open,
  }
}

function createService(
  ffmpegPath: string,
  delivery: MediaContentDeliveryService,
): MediaVariantService {
  const configuration = {
    contentDeliveryMode: 'application',
    driver: 'local',
    ffmpegPath,
    ffprobePath: '/usr/bin/ffprobe',
    qpdfPath: '/usr/bin/qpdf',
    stagingTtlHours: 24,
    storageEnvironment: 'dev',
    storageRoot: '/var/lib/qianshu-media-spec',
    trashRetentionDays: 7,
  } as MediaConfiguration
  return new MediaVariantService(delivery, configuration)
}

/** 用真实 shell 脚本替代 ffmpeg：脚本行为完全由用例决定，服务仍走真实的 spawn 与超时路径。 */
async function writeFakeExecutable(body: string): Promise<string> {
  const directory = await createTemporaryDirectory()
  const executable = join(directory, 'ffmpeg')
  await writeFile(executable, `#!/bin/sh\n${body}\n`)
  await chmod(executable, 0o755)
  return executable
}

function runProcess(
  command: string,
  args: readonly string[],
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'ignore', 'ignore'] })
    child.once('error', rejectPromise)
    child.once('close', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`process exited with code ${code}`))
    })
  })
}

async function resolveRealFfmpeg(): Promise<string> {
  const candidates = [
    process.env.MEDIA_FFMPEG_PATH,
    process.platform === 'darwin' ? '/opt/homebrew/bin/ffmpeg' : undefined,
    '/usr/bin/ffmpeg',
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  for (const candidate of candidates) {
    try {
      await access(candidate, filesystemConstants.X_OK)
      return candidate
    }
    catch {
      // 继续检查下一个候选；缺失时用一条可执行的错误提示统一暴露。
    }
  }
  throw new Error(
    'Media variant poster tests require ffmpeg; install it or set MEDIA_FFMPEG_PATH',
  )
}

async function createSolidImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#336699' },
  }).png().toBuffer()
}

async function createSolidJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#996633' },
  }).jpeg().toBuffer()
}

describe('MediaVariantService', () => {
  it('renders a bounded webp thumbnail from immutable bytes and reuses the cache', async () => {
    const { delivery, open } = createDelivery([await createSolidImage(1200, 800)])
    const service = createService('/usr/bin/false', delivery)

    const thumbnail = await service.render({
      checksumSha256: CHECKSUM,
      objectKey: IMAGE_KEY,
      variant: 'thumb',
    })

    expect(thumbnail).not.toBeNull()
    const metadata = await sharp(thumbnail!).metadata()
    expect(MEDIA_VARIANT_CONTENT_TYPE).toBe('image/webp')
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(512)
    expect(metadata.height).toBeGreaterThan(300)
    expect(metadata.height).toBeLessThanOrEqual(512)

    const repeated = await service.render({
      checksumSha256: CHECKSUM,
      objectKey: IMAGE_KEY,
      variant: 'thumb',
    })
    expect(repeated).toBe(thumbnail)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent renders of the same immutable content', async () => {
    const { delivery, open } = createDelivery([await createSolidImage(600, 600)])
    const service = createService('/usr/bin/false', delivery)

    const [first, second] = await Promise.all([
      service.render({ checksumSha256: CHECKSUM, objectKey: IMAGE_KEY, variant: 'thumb' }),
      service.render({ checksumSha256: CHECKSUM, objectKey: IMAGE_KEY, variant: 'thumb' }),
    ])

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('rejects non-binary chunks instead of coercing them', async () => {
    const { delivery } = createDelivery(['not-a-buffer'])
    const service = createService('/usr/bin/false', delivery)

    await expect(service.render({
      checksumSha256: CHECKSUM,
      objectKey: IMAGE_KEY,
      variant: 'thumb',
    })).resolves.toBeNull()
  })

  it('refuses images above the persisted content size limit', async () => {
    const { delivery } = createDelivery([Buffer.alloc(11 * 1024 * 1024)])
    const service = createService('/usr/bin/false', delivery)

    await expect(service.render({
      checksumSha256: CHECKSUM,
      objectKey: IMAGE_KEY,
      variant: 'thumb',
    })).resolves.toBeNull()
  })

  it('extracts a poster frame through the configured ffmpeg executable', async () => {
    const frame = await createSolidJpeg(640, 360)
    const framePath = join(await createTemporaryDirectory(), 'frame.jpg')
    await writeFile(framePath, frame)
    const ffmpegPath = await writeFakeExecutable(`cat '${framePath}'`)
    const { delivery } = createDelivery([Buffer.from('fake-video')])
    const service = createService(ffmpegPath, delivery)

    const poster = await service.render({
      checksumSha256: CHECKSUM,
      objectKey: VIDEO_KEY,
      variant: 'poster',
    })

    expect(poster).not.toBeNull()
    const metadata = await sharp(poster!).metadata()
    expect(metadata.format).toBe('webp')
    // 封面与缩略图共用同一边长上限：卡片按 2x 渲染也足够锐利。
    expect(metadata.width).toBe(512)
    expect(metadata.height).toBe(288)
  })

  it('falls back to the first frame when the one-second offset yields nothing', async () => {
    const frame = await createSolidJpeg(320, 180)
    const framePath = join(await createTemporaryDirectory(), 'frame.jpg')
    await writeFile(framePath, frame)
    // 只有非 -ss 1 的调用会输出帧，模拟短于 1 秒的视频。
    const ffmpegPath = await writeFakeExecutable(
      `case "$*" in *"-ss 1"*) exit 0 ;; *) cat '${framePath}' ;; esac`,
    )
    const { delivery } = createDelivery([Buffer.from('fake-video')])
    const service = createService(ffmpegPath, delivery)

    const poster = await service.render({
      checksumSha256: CHECKSUM,
      objectKey: VIDEO_KEY,
      variant: 'poster',
    })

    expect(poster).not.toBeNull()
    expect((await sharp(poster!).metadata()).width).toBe(320)
  })

  it('returns null instead of throwing when the executable fails or is missing', async () => {
    const failing = await writeFakeExecutable('exit 9')
    const { delivery } = createDelivery([Buffer.from('fake-video')])

    await expect(createService(failing, delivery).render({
      checksumSha256: CHECKSUM,
      objectKey: VIDEO_KEY,
      variant: 'poster',
    })).resolves.toBeNull()

    await expect(createService('/nonexistent/ffmpeg', delivery).render({
      checksumSha256: CHECKSUM,
      objectKey: VIDEO_KEY,
      variant: 'poster',
    })).resolves.toBeNull()
  })

  it('aborts frame extraction that exceeds the output budget', async () => {
    const oversized = await writeFakeExecutable('head -c 17000000 /dev/zero')
    const { delivery } = createDelivery([Buffer.from('fake-video')])
    const service = createService(oversized, delivery)

    await expect(service.render({
      checksumSha256: CHECKSUM,
      objectKey: VIDEO_KEY,
      variant: 'poster',
    })).resolves.toBeNull()
  })

  it('extracts a real poster frame from a generated video', async () => {
    const ffmpegPath = await resolveRealFfmpeg()
    const directory = await createTemporaryDirectory()
    const videoPath = join(directory, 'sample.mp4')
    await runProcess(ffmpegPath, [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc=size=320x240:rate=10',
      '-t', '1',
      '-pix_fmt', 'yuv420p',
      '-y', videoPath,
    ])

    const { delivery } = createDelivery([await readFile(videoPath)])
    const service = createService(ffmpegPath, delivery)

    const poster = await service.render({
      checksumSha256: CHECKSUM,
      objectKey: VIDEO_KEY,
      variant: 'poster',
    })

    expect(poster).not.toBeNull()
    const metadata = await sharp(poster!).metadata()
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(320)
    expect(metadata.height).toBe(240)
  })
})

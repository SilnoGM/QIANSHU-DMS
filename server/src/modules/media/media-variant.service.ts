import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Injectable } from '@nestjs/common'
import sharp from 'sharp'

import type { MediaConfiguration } from '../../config/media.config'
import { IMMUTABLE_MEDIA_CACHE_CONTROL } from '../../infrastructure/http/private-no-store.interceptor'
import { MediaContentDeliveryService } from './media-content-delivery.service'
import { MEDIA_CONTENT_SIZE_LIMITS } from './media-validation'

/**
 * 派生变体是「读时生成、按内容摘要缓存」的呈现层产物，绝不写入对象存储。
 *
 * 桶内对象与数据库登记因此保持一对一：对账、回收站与对象键规范完全不需要认识派生对象，
 * 存量对象也自动获得变体能力。代价是每个 (客户端 × 资源) 的首次请求付出一次派生 CPU，
 * 随后由变体响应自身声明的长期私有缓存承担。
 */
export const MEDIA_VARIANT_NAMES = ['thumb', 'poster'] as const

export type MediaVariantName = (typeof MEDIA_VARIANT_NAMES)[number]

export const MEDIA_VARIANT_CONTENT_TYPE = 'image/webp'
export const MEDIA_VARIANT_FILE_EXTENSION = '.webp'
/** 变体由不可变原件确定性派生，URL 里的资产标识不可复用，因此可以长期私有缓存。 */
export const MEDIA_VARIANT_CACHE_CONTROL = IMMUTABLE_MEDIA_CACHE_CONTROL

/** 列表与图板的最大渲染边长；详情与预览继续使用原件。 */
const VARIANT_MAX_EDGE_PIXELS = 512
const VARIANT_WEBP_QUALITY = 78
/** 输入像素上限与采购单缩略保持一致，避免解码花屏图时无界分配。 */
const MAX_INPUT_PIXELS = 40_000_000
/** 封面帧取第 1 秒，短视频回退到第 0 秒；两者都为空则视为派生失败。 */
const POSTER_FRAME_OFFSETS_SECONDS = ['1', '0'] as const
const POSTER_EXTRACTION_TIMEOUT_MILLISECONDS = 30_000
/** 单帧 JPEG 的理论上限远低于该值；超过即视为 ffmpeg 输出失控并立即终止。 */
const POSTER_FRAME_LIMIT_BYTES = 16 * 1024 * 1024
/** 进程内缓存按条目数与字节数双重封顶，超出按插入顺序淘汰最旧项。 */
const VARIANT_CACHE_MAX_ENTRIES = 256
const VARIANT_CACHE_MAX_BYTES = 96 * 1024 * 1024

export function isMediaVariantName(value: unknown): value is MediaVariantName {
  return (MEDIA_VARIANT_NAMES as readonly unknown[]).includes(value)
}

interface RenderMediaVariantInput {
  readonly checksumSha256: string
  readonly objectKey: string
  readonly variant: MediaVariantName
}

@Injectable()
export class MediaVariantService {
  private readonly cache = new Map<string, Buffer>()
  private readonly inFlight = new Map<string, Promise<Buffer | null>>()
  private cachedBytes = 0

  constructor(
    private readonly delivery: MediaContentDeliveryService,
    private readonly configuration: MediaConfiguration,
  ) {}

  /**
   * 生成或复用变体字节；任何失败都返回 null，由调用方决定回退语义。
   *
   * 同一内容摘要的并发请求共享同一次派生，避免多个列表同时打开视频卡片时重复解码。
   */
  async render(input: RenderMediaVariantInput): Promise<Buffer | null> {
    const cacheKey = `${input.variant}:${input.checksumSha256}`
    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) {
      this.touch(cacheKey, cached)
      return cached
    }

    const pending = this.inFlight.get(cacheKey)
    if (pending !== undefined) return pending

    const task = this.renderUncached(input)
      .then((buffer) => {
        if (buffer !== null) this.store(cacheKey, buffer)
        return buffer
      })
      .catch(() => null)
      .finally(() => {
        this.inFlight.delete(cacheKey)
      })
    this.inFlight.set(cacheKey, task)
    return task
  }

  private async renderUncached(
    input: RenderMediaVariantInput,
  ): Promise<Buffer | null> {
    if (input.variant === 'thumb') {
      const source = await this.readObject(
        input.objectKey,
        MEDIA_CONTENT_SIZE_LIMITS.IMAGE,
      )
      return source === null ? null : this.encodeWebp(source)
    }

    const directory = await mkdtemp(join(tmpdir(), 'qianshu-media-poster-'))
    try {
      const sourcePath = join(directory, 'source.bin')
      const downloaded = await this.downloadObject(
        input.objectKey,
        MEDIA_CONTENT_SIZE_LIMITS.VIDEO,
        sourcePath,
      )
      if (!downloaded) return null

      for (const offset of POSTER_FRAME_OFFSETS_SECONDS) {
        const frame = await this.extractFrame(sourcePath, offset)
        if (frame !== null) return this.encodeWebp(frame)
      }
      return null
    }
    finally {
      await rm(directory, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  private async readObject(
    objectKey: string,
    limitBytes: bigint,
  ): Promise<Buffer | null> {
    const stored = await this.delivery.open(objectKey)
    const chunks: Buffer[] = []
    let size = 0n

    try {
      for await (const raw of stored.stream) {
        const chunk: unknown = raw
        if (!Buffer.isBuffer(chunk)) return null
        size += BigInt(chunk.length)
        if (size > limitBytes) return null
        chunks.push(chunk)
      }
    }
    catch {
      return null
    }
    finally {
      stored.stream.destroy()
    }

    return chunks.length === 0 ? null : Buffer.concat(chunks)
  }

  /**
   * 视频封面需要可寻址的本地文件：mp4 的 moov 可能位于文件尾，管道输入会在定位时失败。
   * 写入过程按上限逐块落盘，内存占用与视频体积无关。
   */
  private async downloadObject(
    objectKey: string,
    limitBytes: bigint,
    destinationPath: string,
  ): Promise<boolean> {
    const stored = await this.delivery.open(objectKey)
    const sink = createWriteStream(destinationPath, { mode: 0o600 })
    let written = 0n

    try {
      for await (const raw of stored.stream) {
        const chunk: unknown = raw
        if (!Buffer.isBuffer(chunk)) return false
        written += BigInt(chunk.length)
        if (written > limitBytes) return false
        if (!sink.write(chunk)) await once(sink, 'drain')
      }
      sink.end()
      await once(sink, 'finish')
      return written > 0n
    }
    catch {
      return false
    }
    finally {
      stored.stream.destroy()
      if (!sink.writableEnded) sink.destroy()
    }
  }

  private async extractFrame(
    sourcePath: string,
    offsetSeconds: string,
  ): Promise<Buffer | null> {
    // 只取冻结的一帧并直接以 MJPEG 写进标准输出；缩放与转码统一交给 sharp，
    // 避免视频路径依赖 ffmpeg 的 webp 容器写入能力。
    return this.runFfmpeg([
      '-v',
      'error',
      '-ss',
      offsetSeconds,
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      '-q:v',
      '3',
      'pipe:1',
    ])
  }

  private runFfmpeg(args: readonly string[]): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false

      const finish = (value: Buffer | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }

      let child: ReturnType<typeof spawn>
      try {
        child = spawn(this.configuration.ffmpegPath, [...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      }
      catch {
        resolve(null)
        return
      }

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(null)
      }, POSTER_EXTRACTION_TIMEOUT_MILLISECONDS)

      // stderr 只做丢弃：ffmpeg 诊断可能包含主机路径，不进入日志或响应。
      child.stderr?.resume()
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > POSTER_FRAME_LIMIT_BYTES) {
          child.kill('SIGKILL')
          finish(null)
          return
        }
        chunks.push(chunk)
      })
      child.once('error', () => finish(null))
      child.once('close', (code) => {
        finish(code === 0 && size > 0 ? Buffer.concat(chunks) : null)
      })
    })
  }

  private async encodeWebp(input: Buffer): Promise<Buffer | null> {
    try {
      return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(VARIANT_MAX_EDGE_PIXELS, VARIANT_MAX_EDGE_PIXELS, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: VARIANT_WEBP_QUALITY })
        .toBuffer()
    }
    catch {
      return null
    }
  }

  private touch(cacheKey: string, buffer: Buffer): void {
    this.cache.delete(cacheKey)
    this.cache.set(cacheKey, buffer)
  }

  private store(cacheKey: string, buffer: Buffer): void {
    this.cache.set(cacheKey, buffer)
    this.cachedBytes += buffer.length

    while (
      this.cache.size > VARIANT_CACHE_MAX_ENTRIES
      || this.cachedBytes > VARIANT_CACHE_MAX_BYTES
    ) {
      const oldest = this.cache.keys().next()
      if (oldest.done === true) return
      const evicted = this.cache.get(oldest.value)
      this.cache.delete(oldest.value)
      if (evicted !== undefined) this.cachedBytes -= evicted.length
    }
  }
}

import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import sharp from 'sharp'

import { MediaContentDeliveryService } from '../media/media-content-delivery.service'

// 企业微信群机器人 image 消息协议强制要求内容 MD5（base64 前），仅用于上游格式校验，
// 不承担安全摘要或完整性保护职责；不能用 SHA-256 替代，否则上游会拒绝消息。

export const WECOM_APP_IMAGE_MAX_BYTES = 10n * 1024n * 1024n
export const WECOM_ROBOT_IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const WECOM_MPNEWS_INLINE_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const MAX_INPUT_PIXELS = 40_000_000

export type WecomImagePayload =
  | {
    readonly ok: true
    readonly mediaType: 'image'
    readonly buffer: Buffer
    readonly mimeType: 'image/jpeg' | 'image/png'
    readonly filename: string
  }
  | { readonly ok: false, readonly code: string, readonly message: string }

export type WecomRobotImagePayload =
  | { readonly ok: true, readonly base64: string, readonly md5: string }
  | { readonly ok: false, readonly code: string, readonly message: string }

function isSupportedImage(mimeType: string | null): mimeType is 'image/jpeg' | 'image/png' {
  return mimeType === 'image/jpeg' || mimeType === 'image/png'
}

/**
 * WECOM 图片适配：应用消息保留原图到 10MB，群机器人压缩到 2MB。
 *
 * 读取走 MediaContentDeliveryService，不接触本地绝对路径；压缩只在内存中进行，
 * 不生成持久化衍生文件。无法压到上限时返回明确错误，由派发器落 PARTIAL/FAILED。
 */
@Injectable()
export class WecomMediaService {
  constructor(private readonly delivery: MediaContentDeliveryService) {}

  async read(objectKey: string): Promise<Buffer> {
    const stored = await this.delivery.open(objectKey)
    const chunks: Buffer[] = []
    for await (const chunk of stored.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  async prepareAppImage(input: {
    readonly buffer: Buffer
    readonly mimeType: string | null
    readonly filename: string
  }): Promise<WecomImagePayload> {
    if (input.buffer.length <= WECOM_APP_IMAGE_MAX_BYTES && isSupportedImage(input.mimeType)) {
      return {
        ok: true,
        mediaType: 'image',
        buffer: input.buffer,
        mimeType: input.mimeType,
        filename: input.filename,
      }
    }
    const compressed = await this.compress(input.buffer, Number(WECOM_APP_IMAGE_MAX_BYTES))
    if (compressed === null) {
      return { ok: false, code: 'WECOM_MEDIA_TOO_LARGE', message: '应用消息图片压缩后仍超过 10MB' }
    }
    return {
      ok: true,
      mediaType: 'image',
      buffer: compressed,
      mimeType: 'image/jpeg',
      filename: input.filename.replace(/\.[^.]+$/u, '') + '.jpg',
    }
  }

  /**
   * mpnews 正文图片走 media/uploadimg，协议要求原图 ≤2MB；这里比应用消息图片更严格。
   */
  async prepareMpnewsInlineImage(input: {
    readonly buffer: Buffer
    readonly mimeType: string | null
    readonly filename: string
  }): Promise<WecomImagePayload> {
    if (input.buffer.length <= WECOM_MPNEWS_INLINE_IMAGE_MAX_BYTES && isSupportedImage(input.mimeType)) {
      return {
        ok: true,
        mediaType: 'image',
        buffer: input.buffer,
        mimeType: input.mimeType,
        filename: input.filename,
      }
    }
    const compressed = await this.compress(input.buffer, WECOM_MPNEWS_INLINE_IMAGE_MAX_BYTES)
    if (compressed === null) {
      return { ok: false, code: 'WECOM_MEDIA_TOO_LARGE', message: 'mpnews 正文图片压缩后仍超过 2MB' }
    }
    return {
      ok: true,
      mediaType: 'image',
      buffer: compressed,
      mimeType: 'image/jpeg',
      filename: input.filename.replace(/\.[^.]+$/u, '') + '.jpg',
    }
  }

  async prepareRobotImage(buffer: Buffer): Promise<WecomRobotImagePayload> {
    const candidate = buffer.length <= WECOM_ROBOT_IMAGE_MAX_BYTES
      ? buffer
      : await this.compress(buffer, WECOM_ROBOT_IMAGE_MAX_BYTES)
    if (candidate === null) {
      return { ok: false, code: 'WECOM_MEDIA_TOO_LARGE', message: '群图片压缩后仍超过 2MB' }
    }
    return {
      ok: true,
      base64: candidate.toString('base64'),
      // 企业微信群机器人协议强制要求图片内容的 MD5；这里只用于上游校验，不作为安全摘要。
      md5: createHash('md5').update(candidate).digest('hex'),
    }
  }

  private async compress(buffer: Buffer, maxBytes: number): Promise<Buffer | null> {
    const attempts = [
      { width: 2_000, quality: 80 },
      { width: 1_600, quality: 75 },
      { width: 1_200, quality: 70 },
      { width: 800, quality: 60 },
    ] as const
    for (const attempt of attempts) {
      const output = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize({ width: attempt.width, height: attempt.width, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: attempt.quality })
        .toBuffer()
      if (output.length <= maxBytes) {
        return output
      }
    }
    return null
  }
}

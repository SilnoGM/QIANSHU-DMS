import { createHash } from 'node:crypto'
import { Transform } from 'node:stream'

import { MediaValidationError } from './media-validation'

export interface MediaStreamDigest {
  readonly checksumSha256: string
  readonly sizeBytes: bigint
}

export interface MediaStreamGuard {
  readonly completion: Promise<MediaStreamDigest>
  readonly stream: Transform
}

/**
 * 建立可插入 pipeline 的透明 Transform，同时计算 size 与 SHA-256。
 *
 * 计数使用 bigint，超限发生在 chunk 向下游转发之前；因此 staging 不会收到越界 chunk，
 * 调用方只需在 pipeline 失败后执行既有 cancel 即可回收此前的 partial bytes。
 */
export function createMediaStreamGuard(maximumBytes: bigint): MediaStreamGuard {
  if (maximumBytes <= 0n) {
    throw new MediaValidationError('MEDIA_VALIDATION_CONFIGURATION_INVALID')
  }

  const hash = createHash('sha256')
  let sizeBytes = 0n
  let settled = false
  let resolveCompletion!: (value: MediaStreamDigest) => void
  let rejectCompletion!: (reason: MediaValidationError) => void
  const completion = new Promise<MediaStreamDigest>((resolvePromise, rejectPromise) => {
    resolveCompletion = resolvePromise
    rejectCompletion = rejectPromise
  })
  // pipeline 的消费者可能在 stream rejection 后才 await completion；预先附加 handler 避免瞬时未处理拒绝。
  void completion.catch(() => undefined)

  const rejectOnce = (error: MediaValidationError): void => {
    if (settled) return
    settled = true
    rejectCompletion(error)
  }

  const stream = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const nextSize = sizeBytes + BigInt(buffer.length)
      if (nextSize > maximumBytes) {
        const error = new MediaValidationError('MEDIA_CONTENT_TOO_LARGE')
        rejectOnce(error)
        callback(error)
        return
      }
      sizeBytes = nextSize
      hash.update(buffer)
      callback(null, buffer)
    },
    flush(callback) {
      if (!settled) {
        settled = true
        resolveCompletion(Object.freeze({
          checksumSha256: hash.digest('hex'),
          sizeBytes,
        }))
      }
      callback()
    },
  })

  stream.once('error', (error) => {
    rejectOnce(
      error instanceof MediaValidationError
        ? error
        : new MediaValidationError('MEDIA_CONTENT_STREAM_FAILED'),
    )
  })
  stream.once('close', () => {
    if (!settled) {
      rejectOnce(new MediaValidationError('MEDIA_CONTENT_STREAM_FAILED'))
    }
  })

  return Object.freeze({ completion, stream })
}

import type { IncomingHttpHeaders } from 'node:http'
import { PassThrough, type Readable } from 'node:stream'

import { HttpStatus } from '@nestjs/common'
import busboy from 'busboy'

import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaValidationError } from '../media/media-validation'

const MAXIMUM_FILE_BYTES = 10 * 1024 * 1024
const MAXIMUM_MULTIPART_OVERHEAD_BYTES = 64 * 1024

export interface NotificationContentMediaMultipartRequest extends Readable {
  readonly headers: IncomingHttpHeaders
}

export interface NotificationContentMediaUploadInput {
  readonly declaredMimeType: string | null
  readonly originalFilename: string
  readonly stream: Readable
}

function multipartError(): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'NOTIFICATION_CONTENT_MEDIA_MULTIPART_INVALID',
    '内容图片上传请求格式无效',
  )
}

function fileTooLargeError(): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'NOTIFICATION_CONTENT_MEDIA_TOO_LARGE',
    '内容图片不得超过 10 MiB',
  )
}

function declaredContentLength(headers: IncomingHttpHeaders): number | null {
  const value = headers['content-length']
  if (value === undefined) return null
  if (Array.isArray(value) || !/^\d+$/u.test(value)) throw multipartError()
  const length = Number(value)
  if (!Number.isSafeInteger(length) || length < 0) throw multipartError()
  return length
}

/**
 * 通知内容图片单文件流式解析。
 *
 * 上传阶段统一放宽到封面上限 10 MiB；正文图片 2 MiB 的严格上限在事件配置保存时按角色复核。
 * 与产品/凭证上传相同：完整 multipart framing 验证通过后才向媒体领域发送 EOF，
 * 避免出现「HTTP 已报错但领域事务已经提交」的状态。
 */
export class NotificationContentMediaMultipartParser {
  async parse<T>(
    request: NotificationContentMediaMultipartRequest,
    handler: (input: NotificationContentMediaUploadInput) => Promise<T>,
  ): Promise<T> {
    const length = declaredContentLength(request.headers)
    if (
      length !== null
      && length > MAXIMUM_FILE_BYTES + MAXIMUM_MULTIPART_OVERHEAD_BYTES
    ) {
      throw fileTooLargeError()
    }

    let multipart: busboy.Busboy
    try {
      multipart = busboy({
        defParamCharset: 'utf8',
        headers: request.headers,
        limits: {
          fieldNameSize: 64,
          fieldSize: 64,
          fields: 0,
          fileSize: MAXIMUM_FILE_BYTES + 1,
          files: 1,
          headerPairs: 100,
        },
        preservePath: false,
      })
    }
    catch {
      throw multipartError()
    }

    let fileSeen = false
    let bridge: PassThrough | undefined
    let failure: ApiException | undefined
    let handlerOutcome: Promise<{ value?: T, error?: unknown }> | undefined

    const fail = (error = multipartError()): void => {
      failure ??= error
      if (bridge !== undefined && !bridge.destroyed) {
        bridge.destroy(new MediaValidationError('MEDIA_CONTENT_STREAM_FAILED'))
      }
    }

    multipart.on('field', () => fail())

    multipart.on('file', (name, file, info) => {
      if (fileSeen || name !== 'file' || info.filename.length === 0) {
        fail()
        file.resume()
        return
      }
      fileSeen = true
      bridge = new PassThrough()
      bridge.on('error', () => undefined)
      file.once('limit', () => fail(fileTooLargeError()))
      file.once('error', () => fail())
      file.pipe(bridge, { end: false })
      handlerOutcome = Promise.resolve()
        .then(() => handler({
          declaredMimeType: info.mimeType.length === 0 ? null : info.mimeType,
          originalFilename: info.filename,
          stream: bridge as PassThrough,
        }))
        .then(
          value => ({ value }),
          (error: unknown) => {
            bridge?.resume()
            return { error }
          },
        )
    })

    multipart.once('filesLimit', () => fail())
    multipart.once('fieldsLimit', () => fail())
    const parsing = new Promise<void>((resolve, reject) => {
      multipart.once('close', resolve)
      multipart.once('error', reject)
      request.once('aborted', () => reject(multipartError()))
      request.once('error', reject)
    })
    try {
      request.pipe(multipart)
      await parsing
    }
    catch {
      fail()
    }

    if (!fileSeen || bridge === undefined || handlerOutcome === undefined) {
      fail()
    }
    if (failure !== undefined) {
      if (handlerOutcome !== undefined) await handlerOutcome
      throw failure
    }
    bridge?.end()
    const outcome = await handlerOutcome
    if (outcome?.error instanceof Error) throw outcome.error
    if (outcome?.error !== undefined) {
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        '服务器内部错误',
      )
    }
    return outcome?.value as T
  }
}

import type { IncomingHttpHeaders } from 'node:http'
import { PassThrough, type Readable } from 'node:stream'

import { HttpStatus } from '@nestjs/common'
import busboy from 'busboy'

import type { MediaType } from '../../../generated/prisma/enums'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { MediaValidationError } from '../../media/media-validation'

const MAXIMUM_FILE_BYTES = 50 * 1024 * 1024
const MAXIMUM_MULTIPART_OVERHEAD_BYTES = 64 * 1024

export interface SalesOrderDocumentMultipartRequest extends Readable {
  readonly headers: IncomingHttpHeaders
}

/**
 * 订单凭证的用途标记。收款凭证与签收单必须显式声明：它们与出单凭证共用同一个上传入口，
 * 且对象键一旦物化不可改写，所以「这份临时文件最终会被当成什么」必须在上传瞬间由客户端声明。
 */
export type SalesOrderDocumentPurpose = 'PAYMENT_VOUCHER' | 'DELIVERY_RECEIPT'

export interface SalesOrderDocumentUploadInput {
  readonly declaredMimeType: string | null
  readonly mediaType: Extract<MediaType, 'IMAGE' | 'DOCUMENT'>
  readonly originalFilename: string
  /** 缺省表示出单凭证；只接受白名单取值。 */
  readonly purpose: SalesOrderDocumentPurpose | null
  readonly stream: Readable
}

function multipartError(): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'SALES_ORDER_DOCUMENT_MULTIPART_INVALID',
    '订单凭证上传请求格式无效',
  )
}

function fileTooLargeError(): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE',
    '订单凭证文件超过大小限制',
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

function normalizeMediaType(value: string | undefined): 'IMAGE' | 'DOCUMENT' | null {
  return value === 'IMAGE' || value === 'DOCUMENT' ? value : null
}

function normalizePurpose(value: string): SalesOrderDocumentPurpose | null {
  return value === 'PAYMENT_VOUCHER' || value === 'DELIVERY_RECEIPT'
    ? value
    : null
}

/** 单文件流式解析；完整 multipart framing 验证通过后才向媒体领域发送 EOF。 */
export class SalesOrderDocumentMultipartParser {
  async parse<T>(
    request: SalesOrderDocumentMultipartRequest,
    handler: (input: SalesOrderDocumentUploadInput) => Promise<T>,
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
          // 两个字段：mediaType 必填，purpose 可选。
          fields: 2,
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

    let mediaTypeValue: string | undefined
    let purposeValue: string | undefined
    let fileSeen = false
    let activeFile: Readable | undefined
    let bridge: PassThrough | undefined
    let failure: ApiException | undefined
    let handlerOutcome: Promise<{ value?: T; error?: unknown }> | undefined

    const fail = (error = multipartError()): void => {
      failure ??= error
      if (bridge !== undefined && !bridge.destroyed) {
        bridge.destroy(new MediaValidationError('MEDIA_CONTENT_STREAM_FAILED'))
      }
      activeFile?.resume()
    }

    multipart.on('field', (name, value, info) => {
      if (fileSeen || info.nameTruncated || info.valueTruncated) {
        fail()
        return
      }
      if (name === 'mediaType') {
        if (mediaTypeValue !== undefined) {
          fail()
          return
        }
        mediaTypeValue = value
        return
      }
      if (name === 'purpose') {
        // 重复出现即视为格式无效：让客户端改成一个字段，而不是让服务端猜哪个生效。
        if (purposeValue !== undefined) {
          fail()
          return
        }
        purposeValue = value
        return
      }
      fail()
    })

    multipart.on('file', (name, file, info) => {
      activeFile = file
      if (fileSeen) {
        fail()
        file.resume()
        return
      }
      fileSeen = true
      const mediaType = normalizeMediaType(mediaTypeValue)
      const purpose = purposeValue === undefined ? null : normalizePurpose(purposeValue)
      if (
        failure !== undefined
        || name !== 'file'
        || mediaType === null
        || (purposeValue !== undefined && purpose === null)
        || info.filename.length === 0
      ) {
        fail()
        file.resume()
        return
      }

      bridge = new PassThrough()
      bridge.on('error', () => undefined)
      file.once('limit', () => fail(fileTooLargeError()))
      file.once('error', () => fail())
      file.pipe(bridge, { end: false })
      handlerOutcome = Promise.resolve()
        .then(() => handler({
          declaredMimeType: info.mimeType.length === 0 ? null : info.mimeType,
          mediaType,
          originalFilename: info.filename,
          purpose,
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

    if (
      !fileSeen
      || mediaTypeValue === undefined
      || bridge === undefined
      || handlerOutcome === undefined
    ) {
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

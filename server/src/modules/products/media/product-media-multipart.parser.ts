import type { IncomingHttpHeaders } from 'node:http'
import { PassThrough, type Readable } from 'node:stream'

import busboy from 'busboy'

import {
  ProductMediaKind,
  type ProductMediaKind as ProductMediaKindValue,
} from '../../../generated/prisma/enums'
import { MediaValidationError } from '../../media/media-validation'
import type { ProductMediaUploadInput } from './product-media.command'
import {
  productMediaFileTooLargeError,
  productMediaInternalError,
  productMediaMultipartInvalidError,
  productMediaUnsupportedTypeError,
} from './product-media.errors'

const MAXIMUM_FILE_BYTES = 500 * 1024 * 1024
const MAXIMUM_MULTIPART_OVERHEAD_BYTES = 64 * 1024
const MAXIMUM_FIELD_NAME_BYTES = 64
const MAXIMUM_FIELD_BYTES = 4 * 1024
const MAXIMUM_HEADER_PAIRS = 100
const EXPECTED_FIELDS = Object.freeze(['kind', 'expectedVersion'] as const)

interface ProductMediaMultipartParserOptions {
  readonly maximumFileBytes?: number
}

export interface ProductMediaMultipartRequest extends Readable {
  readonly headers: IncomingHttpHeaders
}

export type ParsedProductMediaUploadInput = ProductMediaUploadInput

interface HandlerOutcome<T> {
  readonly error?: unknown
  readonly value?: T
}

function normalizeExpectedVersion(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) return null
  const normalized = Number(value)
  return Number.isSafeInteger(normalized) ? normalized : null
}

function normalizeKind(value: string | undefined): ProductMediaKindValue | null {
  if (value === ProductMediaKind.IMAGE || value === ProductMediaKind.VIDEO) {
    return value
  }
  return null
}

function requireMaximumFileBytes(value: number | undefined): number {
  const normalized = value ?? MAXIMUM_FILE_BYTES
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Product media multipart maximum file bytes is invalid')
  }
  return normalized
}

function declaredContentLength(headers: IncomingHttpHeaders): number | null {
  const rawValue = headers['content-length']
  if (rawValue === undefined) return null
  if (Array.isArray(rawValue) || !/^\d+$/u.test(rawValue)) {
    throw productMediaMultipartInvalidError()
  }
  const normalized = Number(rawValue)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw productMediaMultipartInvalidError()
  }
  return normalized
}

/**
 * Busboy 只负责 multipart framing；文件内容通过 PassThrough 直接交给 MediaAsset。
 * PassThrough 的 EOF 会延迟到 parser 验证完整个 multipart 之后，保证尾部未知字段、
 * 第二个文件或截断请求不能出现“HTTP 返回错误但领域事务已经提交”的状态。
 */
export class ProductMediaMultipartParser {
  private readonly maximumFileBytes: number

  constructor(options: ProductMediaMultipartParserOptions = {}) {
    this.maximumFileBytes = requireMaximumFileBytes(options.maximumFileBytes)
  }

  async parse<T>(
    request: ProductMediaMultipartRequest,
    handler: (input: ParsedProductMediaUploadInput) => Promise<T>,
  ): Promise<T> {
    const contentLength = declaredContentLength(request.headers)
    if (
      contentLength !== null
      && contentLength > this.maximumFileBytes + MAXIMUM_MULTIPART_OVERHEAD_BYTES
    ) {
      throw productMediaFileTooLargeError()
    }

    let multipart: busboy.Busboy
    try {
      multipart = busboy({
        // Chromium/Firefox/Safari 均把 multipart filename 参数写成 UTF-8 bytes。
        // Busboy 默认按 Latin-1 解码会把中文持久化为 mojibake，且后续安全净化
        // 会移除其中的 C1 控制字符而不可逆；必须在最外层解析边界先正确解码。
        defParamCharset: 'utf8',
        headers: request.headers,
        limits: {
          fieldNameSize: MAXIMUM_FIELD_NAME_BYTES,
          fieldSize: MAXIMUM_FIELD_BYTES,
          fields: EXPECTED_FIELDS.length,
          // Busboy 在达到 fileSize 时就截断；使用上限 + 1 才能允许精确等于业务上限的文件。
          fileSize: this.maximumFileBytes + 1,
          files: 1,
          headerPairs: MAXIMUM_HEADER_PAIRS,
        },
        preservePath: false,
      })
    }
    catch {
      throw productMediaMultipartInvalidError()
    }

    const fields = new Map<string, string>()
    let activeFile: (Readable & { truncated?: boolean }) | undefined
    let bridge: PassThrough | undefined
    let fileSeen = false
    let failure: ReturnType<typeof productMediaMultipartInvalidError> | undefined
    let handlerOutcome: Promise<HandlerOutcome<T>> | undefined

    const failMultipart = (): void => {
      failure ??= productMediaMultipartInvalidError()
      if (bridge && !bridge.destroyed) {
        bridge.destroy(new MediaValidationError('MEDIA_CONTENT_STREAM_FAILED'))
      }
      activeFile?.resume()
    }
    const failTooLarge = (): void => {
      failure ??= productMediaFileTooLargeError()
      if (bridge && !bridge.destroyed) {
        bridge.destroy(new MediaValidationError('MEDIA_CONTENT_TOO_LARGE'))
      }
      activeFile?.resume()
    }
    const failUnsupportedType = (): void => {
      failure ??= productMediaUnsupportedTypeError()
      if (bridge && !bridge.destroyed) {
        bridge.destroy(new MediaValidationError('MEDIA_CONTENT_UNSUPPORTED'))
      }
      activeFile?.resume()
    }

    multipart.on('field', (name, value, info) => {
      if (
        fileSeen
        || !EXPECTED_FIELDS.includes(name as typeof EXPECTED_FIELDS[number])
        || fields.has(name)
        || info.nameTruncated
        || info.valueTruncated
      ) {
        failMultipart()
        return
      }
      fields.set(name, value)
    })

    multipart.on('file', (name, file, info) => {
      activeFile = file
      if (fileSeen) {
        failMultipart()
        file.resume()
        return
      }
      fileSeen = true

      const kind = normalizeKind(fields.get('kind'))
      const expectedVersion = normalizeExpectedVersion(fields.get('expectedVersion'))
      if (fields.has('kind') && kind === null) {
        failUnsupportedType()
        file.resume()
        return
      }
      if (
        failure
        || fields.size !== EXPECTED_FIELDS.length
        || name !== 'file'
        || info.filename.length === 0
        || kind === null
        || expectedVersion === null
      ) {
        failMultipart()
        file.resume()
        return
      }

      bridge = new PassThrough()
      // handler 在下一个 microtask 才开始读取；提前安装 listener，避免同一输入 chunk
      // 内紧随文件出现的非法尾部 part 造成未监听 error。
      bridge.on('error', () => undefined)
      file.once('limit', failTooLarge)
      file.once('error', failMultipart)
      file.pipe(bridge, { end: false })

      const input: ParsedProductMediaUploadInput = {
        declaredMimeType: info.mimeType.length === 0 ? null : info.mimeType,
        expectedVersion,
        kind,
        originalFilename: info.filename,
        stream: bridge,
      }
      handlerOutcome = Promise.resolve()
        .then(() => handler(input))
        .then(
          value => ({ value }),
          (error: unknown) => {
            // 版本预检可能在读取文件前失败；切到 flowing 模式才能让 parser
            // 排空剩余请求并返回领域错误，不能因背压永久挂起连接。
            bridge?.resume()
            return { error }
          },
        )
    })

    multipart.once('filesLimit', failMultipart)
    multipart.once('fieldsLimit', failMultipart)

    const parsing = new Promise<void>((resolve, reject) => {
      multipart.once('close', resolve)
      multipart.once('error', reject)
      request.once('aborted', () => reject(productMediaMultipartInvalidError()))
      request.once('error', reject)
    })

    try {
      request.pipe(multipart)
      await parsing
    }
    catch {
      failMultipart()
    }

    if (
      !fileSeen
      || fields.size !== EXPECTED_FIELDS.length
      || handlerOutcome === undefined
      || bridge === undefined
    ) {
      failMultipart()
    }

    if (failure) {
      if (handlerOutcome) await handlerOutcome
      throw failure
    }

    // 完整 framing 已验证，至此才允许领域流观察 EOF 并进入 validator/final transaction。
    bridge?.end()
    const outcome = await handlerOutcome
    if (outcome?.error instanceof Error) throw outcome.error
    if (outcome?.error !== undefined) throw productMediaInternalError()
    return outcome?.value as T
  }
}

import type { Readable } from 'node:stream'

import COS from 'cos-nodejs-sdk-v5'

export type CosObjectClientErrorCode =
  | 'COS_CLIENT_ACCESS_DENIED'
  | 'COS_CLIENT_CONFIGURATION_INVALID'
  | 'COS_CLIENT_CONFLICT'
  | 'COS_CLIENT_INVALID_RANGE'
  | 'COS_CLIENT_NOT_FOUND'
  | 'COS_CLIENT_UNAVAILABLE'

/**
 * 客户端错误只保留固定码和固定文案。
 *
 * SDK 异常对象携带请求 URL（含签名参数）、Header 与服务端诊断，直接向上抛出会把预签名信息
 * 带进日志、审计事件和 HTTP 错误体，因此这里在边界处丢弃全部底层细节。
 */
const COS_OBJECT_CLIENT_ERROR_MESSAGES: Readonly<
  Record<CosObjectClientErrorCode, string>
> = {
  COS_CLIENT_ACCESS_DENIED: 'COS object client access was denied',
  COS_CLIENT_CONFIGURATION_INVALID: 'COS object client configuration is invalid',
  COS_CLIENT_CONFLICT: 'COS object client target already exists',
  COS_CLIENT_INVALID_RANGE: 'COS object client byte range is invalid',
  COS_CLIENT_NOT_FOUND: 'COS object client object was not found',
  COS_CLIENT_UNAVAILABLE: 'COS object client is unavailable',
}

export class CosObjectClientError extends Error {
  readonly code: CosObjectClientErrorCode

  constructor(code: CosObjectClientErrorCode) {
    super(COS_OBJECT_CLIENT_ERROR_MESSAGES[code])
    this.name = 'CosObjectClientError'
    this.code = code
  }
}

export interface CosObjectClientTarget {
  readonly bucket: string
  readonly region: string
  readonly secretId: string
  readonly secretKey: string
}

export interface CosObjectRange {
  readonly end: number
  readonly start: number
}

export interface CosObjectSummary {
  readonly key: string
  readonly modifiedAt: Date
  readonly sizeBytes: bigint
}

export interface CosStoredObjectHead extends CosObjectSummary {
  /** COS 服务端对已存字节计算的 CRC64；缺失时为 null，调用方不得据此放宽校验。 */
  readonly crc64: string | null
  readonly metadata: Readonly<Record<string, string>>
}

export interface CosObjectPage {
  readonly nextCursor: string | null
  readonly objects: readonly CosObjectSummary[]
}

export interface CosObjectListRequest {
  readonly cursor?: string
  readonly limit: number
  readonly prefix: string
}

export interface CosObjectPutRequest {
  readonly contentLength: number
  readonly key: string
  readonly sha256: string
  readonly stream: Readable
}

export interface CosObjectPutResult {
  readonly crc64: string | null
}

/**
 * COS 能力的窄接口：只有本文件依赖 SDK，存储实现与测试都面向这组方法与固定错误码。
 */
export interface CosObjectClient {
  copyObject(sourceKey: string, targetKey: string): Promise<void>
  deleteObject(key: string): Promise<void>
  headBucket(): Promise<void>
  /** 对象不存在（404）返回 null，不作为异常；其余失败按固定码抛出。 */
  headObject(key: string): Promise<CosStoredObjectHead | null>
  listObjects(request: CosObjectListRequest): Promise<CosObjectPage>
  openObjectStream(key: string, range?: CosObjectRange): Promise<Readable>
  putObject(request: CosObjectPutRequest): Promise<CosObjectPutResult>
}

const SDK_REQUEST_TIMEOUT_MS = 60_000
const SHA256_METADATA_HEADER = 'x-cos-meta-sha256'
const CRC64_HEADER = 'x-cos-hash-crc64ecma'

/**
 * 同地域访问时 COS 默认域名会解析到内网地址，因此不需要额外配置 endpoint；
 * 该结论依赖「服务器与存储桶同地域」，跨地域部署必须重新评估流量费用。
 */
export function readCosCredentials(
  environment: Record<string, unknown>,
): { readonly secretId: string; readonly secretKey: string } {
  const secretId = environment.MEDIA_COS_SECRET_ID
  const secretKey = environment.MEDIA_COS_SECRET_KEY
  if (typeof secretId !== 'string' || typeof secretKey !== 'string') {
    throw new CosObjectClientError('COS_CLIENT_CONFIGURATION_INVALID')
  }
  return Object.freeze({ secretId, secretKey })
}

function readHeader(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | null {
  if (!headers) return null
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  }
  return null
}

function readMetadata(headers: Record<string, unknown> | undefined): Record<string, string> {
  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    const normalized = key.toLowerCase()
    if (!normalized.startsWith('x-cos-meta-')) continue
    if (typeof value === 'string') metadata[normalized] = value
  }
  return Object.freeze(metadata)
}

function readSignedHeaderNumber(
  headers: Record<string, unknown> | undefined,
  name: string,
): number | null {
  const raw = readHeader(headers, name)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function sdkStatusCode(error: unknown): number | null {
  const candidate = (error as { statusCode?: unknown } | null)?.statusCode
  if (typeof candidate === 'number') return candidate
  if (typeof candidate === 'string') {
    const parsed = Number(candidate)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function sdkErrorCode(error: unknown): string | null {
  const candidate = (error as { code?: unknown } | null)?.code
  return typeof candidate === 'string' ? candidate : null
}

function mapCosError(error: unknown): CosObjectClientError {
  if (error instanceof CosObjectClientError) return error

  const statusCode = sdkStatusCode(error)
  const code = sdkErrorCode(error)

  if (statusCode === 404 || code === 'NoSuchKey' || code === 'NoSuchBucket') {
    return new CosObjectClientError('COS_CLIENT_NOT_FOUND')
  }
  if (
    statusCode === 403 ||
    code === 'AccessDenied' ||
    code === 'SignatureDoesNotMatch' ||
    code === 'InvalidAccessKeyId'
  ) {
    return new CosObjectClientError('COS_CLIENT_ACCESS_DENIED')
  }
  // 412 与 409 都可能是「目标已存在」的拒绝：覆盖 forbid-overwrite 与条件复制两条路径。
  if (statusCode === 412 || statusCode === 409 || code === 'PreconditionFailed') {
    return new CosObjectClientError('COS_CLIENT_CONFLICT')
  }
  if (statusCode === 416 || code === 'InvalidRange') {
    return new CosObjectClientError('COS_CLIENT_INVALID_RANGE')
  }
  return new CosObjectClientError('COS_CLIENT_UNAVAILABLE')
}

function buildCopySource(
  target: CosObjectClientTarget,
  sourceKey: string,
): string {
  // CopySource 只接受不带协议的主机 + 路径；对象键按路径段编码，斜杠必须保留。
  const encodedKey = sourceKey.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `${target.bucket}.cos.${target.region}.myqcloud.com/${encodedKey}`
}

export function createCosObjectClient(
  target: CosObjectClientTarget,
): CosObjectClient {
  const cos = new COS({
    SecretId: target.secretId,
    SecretKey: target.secretKey,
    Protocol: 'https',
    Timeout: SDK_REQUEST_TIMEOUT_MS,
  })
  const bucketParams = { Bucket: target.bucket, Region: target.region }

  return {
    async copyObject(sourceKey: string, targetKey: string): Promise<void> {
      try {
        await cos.putObjectCopy({
          ...bucketParams,
          CopySource: buildCopySource(target, sourceKey),
          Key: targetKey,
        })
      }
      catch (error) {
        throw mapCosError(error)
      }
    },

    async deleteObject(key: string): Promise<void> {
      try {
        await cos.deleteObject({ ...bucketParams, Key: key })
      }
      catch (error) {
        // DeleteObject 对不存在的对象同样返回成功，因此无需为 404 特判。
        throw mapCosError(error)
      }
    },

    async headBucket(): Promise<void> {
      try {
        await cos.headBucket(bucketParams)
      }
      catch (error) {
        throw mapCosError(error)
      }
    },

    async headObject(key: string): Promise<CosStoredObjectHead | null> {
      let result
      try {
        result = await cos.headObject({ ...bucketParams, Key: key })
      }
      catch (error) {
        const mapped = mapCosError(error)
        if (mapped.code === 'COS_CLIENT_NOT_FOUND') return null
        throw mapped
      }
      const sizeBytes = readSignedHeaderNumber(result.headers, 'content-length')
      const modifiedAt = readHeader(result.headers, 'last-modified')
      if (sizeBytes === null || modifiedAt === null) {
        // HEAD 缺少长度或时间时不能伪造元数据：对账依赖这两个字段判断存在性与变更。
        throw new CosObjectClientError('COS_CLIENT_UNAVAILABLE')
      }
      return Object.freeze({
        crc64: readHeader(result.headers, CRC64_HEADER),
        key,
        metadata: readMetadata(result.headers),
        modifiedAt: new Date(modifiedAt),
        sizeBytes: BigInt(sizeBytes),
      })
    },

    async listObjects(request: CosObjectListRequest): Promise<CosObjectPage> {
      let result
      try {
        result = await cos.getBucket({
          ...bucketParams,
          MaxKeys: request.limit,
          Prefix: request.prefix,
          ...(request.cursor === undefined ? {} : { Marker: request.cursor }),
        })
      }
      catch (error) {
        throw mapCosError(error)
      }
      const objects = (result.Contents ?? []).map(entry => Object.freeze({
        key: entry.Key,
        modifiedAt: new Date(entry.LastModified),
        sizeBytes: BigInt(entry.Size),
      }))
      const truncated = String(result.IsTruncated) === 'true'
      return Object.freeze({
        // cursor 沿用「本页最后一个对象键」的端口语义；COS 的 Marker 为排他游标，可直接复用。
        nextCursor: truncated ? (objects.at(-1)?.key ?? null) : null,
        objects: Object.freeze(objects),
      })
    },

    openObjectStream(key: string, range?: CosObjectRange): Promise<Readable> {
      try {
        // getObjectStream 在 Node 运行时返回 Readable；类型声明用的是宽泛 Stream，因此在此收窄。
        return Promise.resolve(cos.getObjectStream({
          ...bucketParams,
          Key: key,
          ...(range === undefined
            ? {}
            : { Range: `bytes=${range.start}-${range.end}` }),
        }) as unknown as Readable)
      }
      catch (error) {
        return Promise.reject(mapCosError(error))
      }
    },

    async putObject(request: CosObjectPutRequest): Promise<CosObjectPutResult> {
      try {
        const result = await cos.putObject({
          ...bucketParams,
          Body: request.stream,
          ContentLength: request.contentLength,
          Key: request.key,
          // 摘要随对象写入自定义元数据，供 HEAD 校验与实际字节比对，避免每次上传都回读全文。
          [SHA256_METADATA_HEADER]: request.sha256,
        })
        return Object.freeze({
          crc64: readHeader(result.headers, CRC64_HEADER),
        })
      }
      catch (error) {
        throw mapCosError(error)
      }
    },
  }
}

const MEBIBYTE = 1024 * 1024

export interface UploadFormat {
  readonly extensions: readonly string[]
  readonly maxBytes: number
  readonly mimeTypes: readonly string[]
}

export interface UploadPolicy {
  readonly formats: readonly UploadFormat[]
}

export type UploadFileFailure = 'type' | 'empty' | 'too-large'

const IMAGE_FORMATS: readonly UploadFormat[] = [
  {
    extensions: ['.jpg', '.jpeg'],
    maxBytes: 10 * MEBIBYTE,
    mimeTypes: ['image/jpeg'],
  },
  {
    extensions: ['.png'],
    maxBytes: 10 * MEBIBYTE,
    mimeTypes: ['image/png'],
  },
  {
    extensions: ['.webp'],
    maxBytes: 10 * MEBIBYTE,
    mimeTypes: ['image/webp'],
  },
]

// XLSX 只保留给柜次源文件与顺联航账单；业务凭证不再接受文档。
const XLSX_FORMAT: UploadFormat = {
  extensions: ['.xlsx'],
  maxBytes: 50 * MEBIBYTE,
  mimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
}

const PRODUCT_VIDEO_FORMATS: readonly UploadFormat[] = [
  {
    extensions: ['.mp4', '.mov', '.m4v'],
    maxBytes: 500 * MEBIBYTE,
    mimeTypes: ['video/mp4', 'video/quicktime', 'video/x-m4v'],
  },
  {
    extensions: ['.webm'],
    maxBytes: 500 * MEBIBYTE,
    mimeTypes: ['video/webm'],
  },
]

/**
 * 前端上传策略只负责文件选择器与即时反馈；真实内容、magic bytes 与解码仍以服务端为准。
 * 业务上传目前只剩图片、产品视频和 Excel 源文件三类格式。
 */
export const UPLOAD_POLICIES = {
  IMAGE_ONLY: { formats: IMAGE_FORMATS },
  PRODUCT_MEDIA: {
    formats: [...IMAGE_FORMATS, ...PRODUCT_VIDEO_FORMATS],
  },
  XLSX_ONLY: {
    formats: [XLSX_FORMAT],
  },
} as const satisfies Readonly<Record<string, UploadPolicy>>

export type UploadPolicyName = keyof typeof UPLOAD_POLICIES

function extensionOf(filename: string): string {
  const separator = filename.lastIndexOf('.')
  return separator <= 0
    ? ''
    : filename.slice(separator).toLocaleLowerCase('en-US')
}

/** accept 同时给出 MIME 与扩展名，兼容只识别其中一种的浏览器。 */
export function uploadAccept(
  policy: UploadPolicy = UPLOAD_POLICIES.IMAGE_ONLY,
): string {
  return [...new Set(
    policy.formats.flatMap(format => [...format.mimeTypes, ...format.extensions]),
  )].sort().join(',')
}

export function policyAccept(name: UploadPolicyName): string {
  return uploadAccept(UPLOAD_POLICIES[name])
}

/** 找到与文件 MIME/扩展名精确配对的策略项；配对规则不允许跨格式借用。 */
export function findUploadFormat(
  file: { readonly name?: string, readonly type: string },
  policy: UploadPolicy = UPLOAD_POLICIES.IMAGE_ONLY,
): UploadFormat | undefined {
  const extension = extensionOf(file.name ?? '')
  const mimeType = file.type.toLocaleLowerCase('en-US')
  return policy.formats.find(candidate =>
    candidate.mimeTypes.includes(mimeType)
    && candidate.extensions.includes(extension),
  )
}

/**
 * 浏览器即时反馈：MIME 与扩展名必须落在同一个格式项内，避免只改后缀或只伪造 MIME。
 * 空文件与超过策略上限的文件在这里直接拒绝；服务端仍会重复校验。
 */
export function validateUploadFile(
  file: { readonly name?: string, readonly size: number, readonly type: string },
  policy: UploadPolicy = UPLOAD_POLICIES.IMAGE_ONLY,
): UploadFileFailure | null {
  if (file.size <= 0) {
    return 'empty'
  }
  const format = findUploadFormat(file, policy)
  if (format === undefined) {
    return 'type'
  }
  return file.size > format.maxBytes ? 'too-large' : null
}

export const IMAGE_ONLY_ACCEPT = policyAccept('IMAGE_ONLY')
export const PRODUCT_MEDIA_ACCEPT = policyAccept('PRODUCT_MEDIA')
export const XLSX_ACCEPT = policyAccept('XLSX_ONLY')

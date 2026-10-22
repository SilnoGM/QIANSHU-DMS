import type { UploadFileFailure } from './upload-policy'

export const UPLOAD_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export type UploadImageFailure = UploadFileFailure

/**
 * 头像、收款码等图片上传共用同一套图片策略：格式、非空与 10 MiB 上限。
 * 真实内容仍由服务端 sharp 校验，这里只做选择文件后的即时反馈。
 */
export function validateUploadImage(
  file: { size: number, type: string },
): UploadImageFailure | null {
  if (!UPLOAD_IMAGE_MIME_TYPES.includes(
    file.type as typeof UPLOAD_IMAGE_MIME_TYPES[number],
  )) {
    return 'type'
  }
  if (file.size <= 0) {
    return 'empty'
  }
  return file.size > UPLOAD_IMAGE_MAX_BYTES ? 'too-large' : null
}

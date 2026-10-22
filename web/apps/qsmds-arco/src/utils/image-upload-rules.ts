import type { UploadFileFailure } from './upload-policy'
import { UPLOAD_POLICIES, validateUploadFile } from './upload-policy'

export const UPLOAD_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export type UploadImageFailure = UploadFileFailure

/**
 * 头像、收款码等图片上传共用统一图片策略：格式、扩展名、非空与 10 MiB 上限。
 * 真实内容仍由服务端 sharp 校验，这里只做选择文件后的即时反馈。
 */
export function validateUploadImage(
  file: { name?: string, size: number, type: string },
): UploadImageFailure | null {
  return validateUploadFile(file, UPLOAD_POLICIES.IMAGE_ONLY)
}

import type { FileTypeResult } from 'file-type'

export type TrustedVideoContainer =
  | {
    readonly canonicalExtension: '.m4v'
    readonly family: 'ISO_BASE_MEDIA'
    readonly kind: 'M4V'
    readonly mimeType: 'video/x-m4v'
  }
  | {
    readonly canonicalExtension: '.mov'
    readonly family: 'ISO_BASE_MEDIA'
    readonly kind: 'MOV'
    readonly mimeType: 'video/quicktime'
  }
  | {
    readonly canonicalExtension: '.mp4'
    readonly family: 'ISO_BASE_MEDIA'
    readonly kind: 'MP4'
    readonly mimeType: 'video/mp4'
  }
  | {
    readonly canonicalExtension: '.webm'
    readonly family: 'WEBM'
    readonly kind: 'WEBM'
    readonly mimeType: 'video/webm'
  }

const ISO_INPUT_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4'])
const ISO_INPUT_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
])

const TRUSTED_IDENTITIES = new Map<string, TrustedVideoContainer>([
  ['m4v\0video/x-m4v', Object.freeze({
    canonicalExtension: '.m4v',
    family: 'ISO_BASE_MEDIA',
    kind: 'M4V',
    mimeType: 'video/x-m4v',
  })],
  ['mov\0video/quicktime', Object.freeze({
    canonicalExtension: '.mov',
    family: 'ISO_BASE_MEDIA',
    kind: 'MOV',
    mimeType: 'video/quicktime',
  })],
  ['mp4\0video/mp4', Object.freeze({
    canonicalExtension: '.mp4',
    family: 'ISO_BASE_MEDIA',
    kind: 'MP4',
    mimeType: 'video/mp4',
  })],
  ['webm\0video/webm', Object.freeze({
    canonicalExtension: '.webm',
    family: 'WEBM',
    kind: 'WEBM',
    mimeType: 'video/webm',
  })],
])

/**
 * 扩展名和 multipart MIME 都是不可信声明，只允许在已确认的小型家族内互认。
 *
 * MP4、MOV、M4V 共享 ISO Base Media/QuickTime 血缘，真实设备可能用其中一种文件名包装另一种
 * major brand；canonical 身份始终来自 magic bytes。WebM 不属于该家族，必须三方精确一致。
 */
export function resolveTrustedVideoContainer(
  extension: string,
  declaredMimeType: string,
  detected: FileTypeResult | undefined,
): TrustedVideoContainer | null {
  if (detected === undefined) return null
  const identity = TRUSTED_IDENTITIES.get(`${detected.ext}\0${detected.mime}`)
  if (identity === undefined) return null

  if (identity.family === 'WEBM') {
    return extension === '.webm' && declaredMimeType === 'video/webm'
      ? identity
      : null
  }

  return ISO_INPUT_EXTENSIONS.has(extension)
    && ISO_INPUT_MIME_TYPES.has(declaredMimeType)
    ? identity
    : null
}

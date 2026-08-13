import sharp from 'sharp'

import {
  MediaValidationError,
  type ValidatedImageContent,
} from './media-validation'

const MAX_IMAGE_PIXELS = 40_000_000
const MAX_IMAGE_EDGE = 16_384

export interface ImageContentIdentity {
  readonly canonicalExtension: '.jpg' | '.png' | '.webp'
  readonly format: 'jpeg' | 'png' | 'webp'
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
}

function browserOrientedDimensions(
  width: number,
  height: number,
  orientation: number | undefined,
): { readonly height: number; readonly width: number } {
  // EXIF 5-8 会交换浏览器最终展示的宽高；本期保留原文件，不执行旋转或重编码。
  return orientation !== undefined && orientation >= 5 && orientation <= 8
    ? { height: width, width: height }
    : { height, width }
}

/**
 * sharp.metadata() 用于取得可信 header 元数据，sharp.stats() 强制 libvips 完整解码全部像素。
 * stats 只返回小型统计对象，不把最多 40M pixels 的 raw buffer 送入 Node.js heap。
 */
export async function validateImageContent(
  sourcePath: string,
  sizeBytes: bigint,
  checksumSha256: string,
  identity: ImageContentIdentity,
): Promise<ValidatedImageContent> {
  const options = {
    animated: true,
    failOn: 'error' as const,
    limitInputPixels: MAX_IMAGE_PIXELS,
    sequentialRead: true,
  }

  try {
    const metadata = await sharp(sourcePath, options).metadata()
    if (
      metadata.format !== identity.format ||
      metadata.width === undefined ||
      metadata.height === undefined ||
      !Number.isSafeInteger(metadata.width) ||
      !Number.isSafeInteger(metadata.height) ||
      metadata.width <= 0 ||
      metadata.height <= 0 ||
      metadata.width > MAX_IMAGE_EDGE ||
      metadata.height > MAX_IMAGE_EDGE ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
      (metadata.pages !== undefined && metadata.pages !== 1)
    ) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }

    await sharp(sourcePath, options).stats()
    const dimensions = browserOrientedDimensions(
      metadata.width,
      metadata.height,
      metadata.orientation,
    )
    return Object.freeze({
      canonicalExtension: identity.canonicalExtension,
      checksumSha256,
      height: dimensions.height,
      mediaType: 'IMAGE',
      mimeType: identity.mimeType,
      sizeBytes,
      width: dimensions.width,
    })
  }
  catch (error) {
    if (error instanceof MediaValidationError) throw error
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
}

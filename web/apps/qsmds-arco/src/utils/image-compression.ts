export const AVATAR_MAX_EDGE = 512
export const AVATAR_WEBP_QUALITY = 0.85

/**
 * 头像只保留展示所需的最大边；小于上限的图片不放大。
 * 这是纯函数，尺寸计算的边界由 Node 单测固定。
 */
export function fitWithinMaxEdge(
  width: number,
  height: number,
  maxEdge = AVATAR_MAX_EDGE,
): { height: number, width: number } {
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || !Number.isFinite(maxEdge)
    || maxEdge <= 0
  ) {
    throw new Error('Invalid image dimensions')
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  }
}

function replacementName(name: string): string {
  const stem = name.replace(/\.[^.]+$/u, '').trim() || 'avatar'
  return `${stem}.webp`
}

/**
 * 上传前在浏览器内缩放并转成 WebP，避免把手机原图直接存进头像资产。
 * 浏览器无法解码时回退原文件，服务端仍会做真实内容与 10 MiB 校验。
 */
export async function compressAvatarFile(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  }
  catch {
    return file
  }

  try {
    const target = fitWithinMaxEdge(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (context === null) {
      return file
    }

    context.drawImage(bitmap, 0, 0, target.width, target.height)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', AVATAR_WEBP_QUALITY)
    })
    if (blob === null || blob.size === 0) {
      return file
    }

    // 已经足够小且重新编码后反而更大时，保留原文件，避免无意义膨胀。
    if (
      blob.size >= file.size
      && target.width === bitmap.width
      && target.height === bitmap.height
    ) {
      return file
    }

    return new File([blob], replacementName(file.name), {
      lastModified: Date.now(),
      type: 'image/webp',
    })
  }
  finally {
    bitmap.close()
  }
}

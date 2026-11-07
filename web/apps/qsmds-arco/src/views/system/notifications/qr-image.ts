const DATA_URI_PREFIX = 'data:'

/**
 * GeWe 的 personal/getQrCode 返回裸 base64，不带 data URI 前缀；
 * 直接作为 img src 会被浏览器当成相对路径。这里按图片魔数补 MIME。
 */
export function qrImageSrc(base64: string): string {
  const value = base64.trim()
  if (value.startsWith(DATA_URI_PREFIX)) {
    return value
  }
  if (value.startsWith('/9j/')) {
    return `data:image/jpeg;base64,${value}`
  }
  if (value.startsWith('iVBOR')) {
    return `data:image/png;base64,${value}`
  }
  if (value.startsWith('R0lGOD')) {
    return `data:image/gif;base64,${value}`
  }
  if (value.startsWith('UklGR')) {
    return `data:image/webp;base64,${value}`
  }
  return `data:image/png;base64,${value}`
}

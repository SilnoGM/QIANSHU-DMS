export const USER_AVATAR_UPLOAD_PURPOSE = 'USER_AVATAR'

const AVATAR_CONTENT_PREFIX = '/api/profile/avatars/'
const AVATAR_CONTENT_SUFFIX = '/content'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/**
 * 头像地址必须落在当前 APP_ORIGIN 上，浏览器 `<img>` 才能带上同源 Session Cookie。
 * 只暴露内容路径，不把存储驱动、对象键或桶名带到客户端。
 */
export function buildAvatarContentUrl(
  appOrigin: string,
  assetId: string,
): string {
  return new URL(
    `${AVATAR_CONTENT_PREFIX}${assetId}${AVATAR_CONTENT_SUFFIX}`,
    appOrigin,
  ).toString()
}

/**
 * 只识别本系统生成的头像内容 URL。外部 URL 继续作为存量/管理端兜底，不在这里拒绝。
 */
export function parseAvatarContentUrl(
  value: string,
  appOrigin: string,
): string | null {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return null
  }

  let origin: string
  try {
    origin = new URL(appOrigin).origin
  }
  catch {
    return null
  }

  if (
    url.origin !== origin
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || !url.pathname.startsWith(AVATAR_CONTENT_PREFIX)
    || !url.pathname.endsWith(AVATAR_CONTENT_SUFFIX)
  ) {
    return null
  }

  const assetId = url.pathname.slice(
    AVATAR_CONTENT_PREFIX.length,
    -AVATAR_CONTENT_SUFFIX.length,
  )
  return UUID_PATTERN.test(assetId) ? assetId : null
}

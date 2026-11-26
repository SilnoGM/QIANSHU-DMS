import { WECOM_API_BASE_URL } from '../../config/wecom.config'

export type WecomWebhookKeyNormalization =
  | { readonly ok: true, readonly key: string }
  | { readonly ok: false, readonly message: string }

const WEBHOOK_PATH = '/cgi-bin/webhook/send'
const WEBHOOK_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

function normalizeRawKey(value: string): WecomWebhookKeyNormalization {
  if (!WEBHOOK_KEY_PATTERN.test(value)) {
    return {
      ok: false,
      message: '只填写 webhook URL 中 key= 后的值，不要填完整 URL 或包含空格、斜杠的文本',
    }
  }
  return { ok: true, key: value }
}

/**
 * 群机器人输入既接受裸 key，也接受官方 webhook URL。
 *
 * URL 必须指向固定企业微信入口与 webhook 路径，只提取 key 入库；避免把完整 URL
 * 当成 key 拼进 query 后由上游返回 93000，且不允许任意主机成为出站目标。
 */
export function normalizeWecomWebhookKey(value: string): WecomWebhookKeyNormalization {
  const raw = value.trim()
  if (raw.length === 0) {
    return { ok: false, message: '请填写群机器人 webhook key' }
  }
  if (!/^https?:\/\//iu.test(raw)) {
    return normalizeRawKey(raw)
  }

  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    return { ok: false, message: 'webhook URL 格式不正确' }
  }
  const base = new URL(WECOM_API_BASE_URL)
  if (
    url.protocol !== 'https:'
    || url.hostname !== base.hostname
    || url.port !== ''
    || url.pathname !== WEBHOOK_PATH
    || url.username !== ''
    || url.password !== ''
  ) {
    return { ok: false, message: 'webhook 地址必须是企业微信内部群机器人 URL' }
  }
  const key = url.searchParams.get('key')?.trim() ?? ''
  if (key.length === 0) {
    return { ok: false, message: 'webhook URL 缺少 key 查询参数' }
  }
  return normalizeRawKey(key)
}

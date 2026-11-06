import { registerAs } from '@nestjs/config'

/**
 * GeWe 的固定入口。
 *
 * 出站地址是服务端安全边界的一部分，不接受环境变量覆盖，避免配置漂移
 * 把 Token 与消息内容发往非预期主机。
 */
export const ASSISTANT_GEWE_BASE_URL = 'https://api.geweapi.com' as const

const DEFAULT_WORKER_POLL_MS = 5_000
const DEFAULT_WORKER_BATCH = 20
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

export interface AssistantConfiguration {
  readonly baseUrl: string
  readonly token: string | null
  readonly workerEnabled: boolean
  readonly pollMs: number
  readonly batchSize: number
  readonly requestTimeoutMs: number
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback
  }
  return parsed
}

/**
 * 配置对象只携带非敏感的定位信息与 Token 本身；Token 只从环境读取，
 * 绝不进入日志、审计、接口响应或前端产物。
 */
export default registerAs('assistant', (): AssistantConfiguration => {
  const token = process.env.ASSISTANT_GEWE_TOKEN?.trim() ?? ''
  return Object.freeze({
    baseUrl: ASSISTANT_GEWE_BASE_URL,
    token: token.length > 0 ? token : null,
    workerEnabled: process.env.ASSISTANT_WORKER_ENABLED !== 'false',
    pollMs: boundedInteger(process.env.ASSISTANT_WORKER_POLL_MS, DEFAULT_WORKER_POLL_MS, 1_000, 300_000),
    batchSize: boundedInteger(process.env.ASSISTANT_WORKER_BATCH, DEFAULT_WORKER_BATCH, 1, 100),
    requestTimeoutMs: boundedInteger(process.env.ASSISTANT_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, 1_000, 60_000),
  })
})

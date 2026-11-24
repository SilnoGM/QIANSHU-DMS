import { registerAs } from '@nestjs/config'

/**
 * 企业微信 API 固定入口。和 GeWe 一样，出站地址属于安全边界，不接受环境变量覆盖。
 */
export const WECOM_API_BASE_URL = 'https://qyapi.weixin.qq.com' as const

const DEFAULT_WORKER_POLL_MS = 5_000
const DEFAULT_WORKER_BATCH = 20
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_APP_MIN_SEND_INTERVAL_MS = 1_000
const DEFAULT_ROBOT_MIN_SEND_INTERVAL_MS = 3_000

export interface WecomConfiguration {
  readonly baseUrl: string
  readonly workerEnabled: boolean
  readonly pollMs: number
  readonly batchSize: number
  readonly requestTimeoutMs: number
  readonly appMinSendIntervalMs: number
  readonly robotMinSendIntervalMs: number
  readonly maxTextBytes: number
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
 * 默认关闭派发：WECOM 渠道必须显式开启 `WECOM_WORKER_ENABLED=true`，
 * 避免应用刚配置、策略尚未就绪时误发。
 */
export default registerAs('wecom', (): WecomConfiguration => {
  return Object.freeze({
    baseUrl: WECOM_API_BASE_URL,
    workerEnabled: process.env.WECOM_WORKER_ENABLED === 'true',
    pollMs: boundedInteger(process.env.WECOM_WORKER_POLL_MS, DEFAULT_WORKER_POLL_MS, 1_000, 300_000),
    batchSize: boundedInteger(process.env.WECOM_WORKER_BATCH, DEFAULT_WORKER_BATCH, 1, 100),
    requestTimeoutMs: boundedInteger(process.env.WECOM_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, 1_000, 60_000),
    appMinSendIntervalMs: boundedInteger(
      process.env.WECOM_APP_MIN_SEND_INTERVAL_MS,
      DEFAULT_APP_MIN_SEND_INTERVAL_MS,
      0,
      60_000,
    ),
    robotMinSendIntervalMs: boundedInteger(
      process.env.WECOM_ROBOT_MIN_SEND_INTERVAL_MS,
      DEFAULT_ROBOT_MIN_SEND_INTERVAL_MS,
      0,
      60_000,
    ),
    maxTextBytes: 2_048,
  })
})

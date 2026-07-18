import { Inject, Injectable, Optional } from '@nestjs/common'

export type AuthLoginMetricResult =
  | 'success'
  | 'failure'
  | 'rate_limited'
export type AuthSessionMetricEvent = 'created' | 'valid' | 'expired'
export type AuthPasswordMetricOperation = 'create' | 'change' | 'reset'
export type AuthPasswordMetricResult = 'success' | 'failure'
export type Argon2MetricOperation = 'hash' | 'verify'
export type Argon2MetricResult = 'success' | 'failure'
export type AuthHttpErrorStatus = 401 | 403 | 429 | 503

export interface AuthMetricOutput {
  log(message: string): void
}

type MetricLabels = Readonly<Record<string, string>>

const LOGIN_RESULTS = new Set<AuthLoginMetricResult>([
  'success',
  'failure',
  'rate_limited',
])
const SESSION_EVENTS = new Set<AuthSessionMetricEvent>([
  'created',
  'valid',
  'expired',
])
const PASSWORD_OPERATIONS = new Set<AuthPasswordMetricOperation>([
  'create',
  'change',
  'reset',
])
const PASSWORD_RESULTS = new Set<AuthPasswordMetricResult>([
  'success',
  'failure',
])
const ARGON2_OPERATIONS = new Set<Argon2MetricOperation>(['hash', 'verify'])
const ARGON2_RESULTS = new Set<Argon2MetricResult>(['success', 'failure'])
const HTTP_ERROR_STATUSES = new Set<AuthHttpErrorStatus>([401, 403, 429, 503])

const NOOP_OUTPUT: AuthMetricOutput = Object.freeze({
  log(): void {},
})

const AUTH_METRIC_OUTPUT = Symbol('AUTH_METRIC_OUTPUT')

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function roundedMilliseconds(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null
  }

  return Math.round(value * 1_000) / 1_000
}

/**
 * 认证运行指标只写单行 JSON，不保存进程内累计状态，也不暴露 HTTP scrape 端点。
 * 每个方法只接受固定枚举与数字，调用方无法把 username、ID、IP、Cookie、密码或
 * 原始错误塞进 Label；输出失败会被吞掉，绝不能反向破坏认证事务。
 */
@Injectable()
export class AuthMetricLogger {
  private readonly output: AuthMetricOutput

  constructor(
    @Inject(AUTH_METRIC_OUTPUT)
    @Optional()
    output: AuthMetricOutput = console,
  ) {
    // 生产默认写 stdout；测试可直接构造并注入捕获器。Optional 避免 Nest
    // 尝试解析 TypeScript interface（运行时已被擦除）为容器依赖。
    this.output = output
  }

  recordLogin(result: AuthLoginMetricResult): void {
    if (!LOGIN_RESULTS.has(result)) {
      return
    }

    this.writeCounter('auth_login_total', 1, { result })
  }

  recordSession(event: AuthSessionMetricEvent): void {
    if (!SESSION_EVENTS.has(event)) {
      return
    }

    this.writeCounter('auth_session_total', 1, { event })
  }

  recordSessionRevoked(count: number): void {
    if (!isNonNegativeSafeInteger(count) || count === 0) {
      return
    }

    this.writeCounter('auth_session_total', count, { event: 'revoked' })
  }

  recordPassword(
    operation: AuthPasswordMetricOperation,
    result: AuthPasswordMetricResult,
  ): void {
    if (
      !PASSWORD_OPERATIONS.has(operation)
      || !PASSWORD_RESULTS.has(result)
    ) {
      return
    }

    this.writeCounter('auth_password_operation_total', 1, {
      operation,
      result,
    })
  }

  recordHttpError(status: AuthHttpErrorStatus): void {
    if (!HTTP_ERROR_STATUSES.has(status)) {
      return
    }

    this.writeCounter('auth_http_error_total', 1, {
      status: String(status),
    })
  }

  recordArgon2Capacity(active: number, queued: number): void {
    if (
      !isNonNegativeSafeInteger(active)
      || !isNonNegativeSafeInteger(queued)
    ) {
      return
    }

    this.writeMetric('auth_argon2_active', active, {})
    this.writeMetric('auth_argon2_queue', queued, {})
  }

  recordArgon2Rejected(operation: Argon2MetricOperation): void {
    if (!ARGON2_OPERATIONS.has(operation)) {
      return
    }

    this.writeCounter('auth_argon2_rejected_total', 1, { operation })
  }

  recordArgon2Latency(
    operation: Argon2MetricOperation,
    result: Argon2MetricResult,
    durationMs: number,
  ): void {
    const safeDuration = roundedMilliseconds(durationMs)
    if (
      !ARGON2_OPERATIONS.has(operation)
      || !ARGON2_RESULTS.has(result)
      || safeDuration === null
    ) {
      return
    }

    this.writeMetric('auth_argon2_latency_ms', safeDuration, {
      operation,
      result,
    })
  }

  private writeCounter(
    metric: string,
    value: number,
    labels: MetricLabels,
  ): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      return
    }

    this.writeMetric(metric, value, labels)
  }

  private writeMetric(
    metric: string,
    value: number,
    labels: MetricLabels,
  ): void {
    try {
      this.output.log(JSON.stringify({
        kind: 'metric',
        metric,
        value,
        labels,
      }))
    } catch {
      // 指标属于 best-effort 可观测性，日志传输失败不能改变认证业务结果。
    }
  }
}

/** 单元测试或手工构造 Service 时使用；生产 Nest Module 会注入真实 stdout Logger。 */
export const NOOP_AUTH_METRIC_LOGGER = new AuthMetricLogger(NOOP_OUTPUT)

export function isAuthHttpErrorStatus(
  status: number,
): status is AuthHttpErrorStatus {
  return HTTP_ERROR_STATUSES.has(status as AuthHttpErrorStatus)
}

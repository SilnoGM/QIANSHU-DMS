import { Injectable } from '@nestjs/common'

export const PERFORMANCE_WINDOW_MS = 5 * 60_000
const MAX_SAMPLES = 5_000
const SLOWEST_LIMIT = 5

export interface PerformanceRecordInput {
  readonly at: number
  readonly durationMs: number
  readonly operation: string
  readonly statusCode: number
}

export interface PerformanceSlowRequest {
  readonly occurredAt: string
  readonly durationMs: number
  readonly operation: string
  readonly statusCode: number
}

export interface PerformanceSnapshot {
  readonly averageMs: number | null
  readonly clientErrors: number
  readonly errorRatePercent: number | null
  readonly p95Ms: number | null
  readonly serverErrors: number
  readonly slowest: PerformanceSlowRequest[]
  readonly totalRequests: number
  readonly windowRequests: number
  readonly windowSeconds: number
}

type Sample = PerformanceRecordInput

function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 进程内请求性能计数。
 *
 * 只保留最近 5 分钟的固定上限样本，用于“当前状态”页面；不持久化、不导出到
 * Prometheus，进程重启后清零。operation 由拦截器用 Controller/Handler 元数据生成，
 * 不记录原始 URL、查询串、用户输入或请求体，避免高基数与敏感信息。
 */
@Injectable()
export class RequestPerformanceMetrics {
  private readonly samples: Sample[] = []
  private totalRequests = 0

  record(input: PerformanceRecordInput): void {
    if (
      !Number.isFinite(input.durationMs)
      || input.durationMs < 0
      || !Number.isInteger(input.statusCode)
      || input.operation.trim() === ''
    ) {
      return
    }

    this.totalRequests += 1
    this.samples.push({
      at: input.at,
      durationMs: input.durationMs,
      operation: input.operation,
      statusCode: input.statusCode,
    })
    this.prune(input.at)
  }

  snapshot(now = Date.now()): PerformanceSnapshot {
    this.prune(now)
    const windowRequests = this.samples.length
    const serverErrors = this.samples.filter(sample => sample.statusCode >= 500).length
    const clientErrors = this.samples.filter(
      sample => sample.statusCode >= 400 && sample.statusCode < 500,
    ).length
    const durations = this.samples
      .map(sample => sample.durationMs)
      .sort((left, right) => left - right)
    const averageMs = durations.length === 0
      ? null
      : roundMilliseconds(
          durations.reduce((sum, value) => sum + value, 0) / durations.length,
        )
    const p95Ms = durations.length === 0
      ? null
      : roundMilliseconds(
          durations[Math.min(
            durations.length - 1,
            Math.max(0, Math.ceil(durations.length * 0.95) - 1),
          )],
        )
    const errorRatePercent = windowRequests === 0
      ? null
      : roundMilliseconds(serverErrors / windowRequests * 100)

    return {
      averageMs,
      clientErrors,
      errorRatePercent,
      p95Ms,
      serverErrors,
      slowest: this.samples
        .slice()
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, SLOWEST_LIMIT)
        .map(sample => ({
          occurredAt: new Date(sample.at).toISOString(),
          durationMs: roundMilliseconds(sample.durationMs),
          operation: sample.operation,
          statusCode: sample.statusCode,
        })),
      totalRequests: this.totalRequests,
      windowRequests,
      windowSeconds: Math.round(PERFORMANCE_WINDOW_MS / 1000),
    }
  }

  reset(): void {
    this.samples.length = 0
    this.totalRequests = 0
  }

  private prune(now: number): void {
    const cutoff = now - PERFORMANCE_WINDOW_MS
    while (this.samples.length > 0 && this.samples[0].at < cutoff) {
      this.samples.shift()
    }
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES)
    }
  }
}

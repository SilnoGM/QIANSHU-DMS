import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'

const GATE_ID = 'assistant-send'
const DEFAULT_MIN_SEND_INTERVAL_MS = 3_000
const DEFAULT_SEND_INTERVAL_JITTER_MS = 2_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const LOCK_POLL_MS = 100
const MIN_LOCK_TTL_MS = 30_000
const LOCK_TTL_MARGIN_MS = 15_000

interface GateClaim {
  readonly waitMs: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/**
 * 计算上一条发送结束后到下一次允许发送的冷却时间。
 *
 * 在最小间隔之上叠加 [0, jitterMs] 的均匀随机抖动（默认 3000 + 0~2000ms），
 * 避免所有消息呈现固定 3 秒节奏。最小间隔为 0 表示本地显式关闭节流，
 * 此时抖动必须一并关闭，否则“关闭”会变成 0~2 秒随机。
 */
export function resolveSendCooldownMs(
  minIntervalMs: number,
  jitterMs: number,
  randomValue: number = Math.random(),
): number {
  if (minIntervalMs <= 0) {
    return 0
  }
  if (jitterMs <= 0) {
    return minIntervalMs
  }
  // 随机源只应来自 [0,1)；这里仍做钳制，避免异常输入把冷却推过抖动上限。
  const normalized = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.999_999) : 0
  return minIntervalMs + Math.floor(normalized * (jitterMs + 1))
}

/**
 * 千树小助理全局发送闸门。
 *
 * 所有 sendText 入口共用同一数据库行：取得发送租约后才允许调用 transport；
 * 上一条消息尚未完成时继续等待，完成后写 `next_allowed_at = 实际结束时间 + 最小间隔 + 随机抖动`。
 * 这里用带过期时间的行级发送租约而不是数据库事务锁，避免长事务在等待网络时占用连接。
 * 故障或进程暂停时租约可能过期，仍无法撤回已经发出的 HTTP 请求；保证范围是我方
 * sendText 请求之间的最小间隔，不是第三方实际送达间隔，也不保证故障下绝不重复。
 */
@Injectable()
export class AssistantSendGateService {
  private readonly logger = new Logger(AssistantSendGateService.name)
  private rowEnsured = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async run<T>(send: () => Promise<T>): Promise<T> {
    await this.ensureRow()
    const config = this.configService.get<AssistantConfiguration>('assistant')
    const intervalMs = config?.minSendIntervalMs ?? DEFAULT_MIN_SEND_INTERVAL_MS
    const jitterMs = config?.sendIntervalJitterMs ?? DEFAULT_SEND_INTERVAL_JITTER_MS
    const requestTimeoutMs = config?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    // 租约必须覆盖“等待上一条冷却 + 本次请求超时”的最坏情况，冷却上限因此要含抖动。
    const lockTtlMs = Math.max(
      MIN_LOCK_TTL_MS,
      intervalMs + jitterMs + requestTimeoutMs + LOCK_TTL_MARGIN_MS,
    )
    const owner = randomUUID()

    for (;;) {
      const claim = await this.tryAcquire(owner, lockTtlMs)
      if (claim === null) {
        await sleep(LOCK_POLL_MS)
        continue
      }
      try {
        if (claim.waitMs > 0) {
          await sleep(claim.waitMs)
        }
        if (!await this.isOwner(owner)) {
          continue
        }
        return await send()
      }
      finally {
        await this.release(owner, resolveSendCooldownMs(intervalMs, jitterMs))
      }
    }
  }

  private async ensureRow(): Promise<void> {
    if (this.rowEnsured) {
      return
    }
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "assistant_send_gates" ("id")
      VALUES (${GATE_ID})
      ON CONFLICT ("id") DO NOTHING
    `)
    this.rowEnsured = true
  }

  private async tryAcquire(owner: string, lockTtlMs: number): Promise<GateClaim | null> {
    const ttlSeconds = Math.ceil(lockTtlMs / 1_000)
    const rows = await this.prisma.$queryRaw<Array<{ waitMs: number }>>(Prisma.sql`
      UPDATE "assistant_send_gates"
      SET "lock_owner" = ${owner}::uuid,
          "lock_expires_at" = clock_timestamp() + make_interval(secs => ${ttlSeconds}),
          "updated_at" = clock_timestamp()
      WHERE "id" = ${GATE_ID}
        AND ("lock_expires_at" IS NULL OR "lock_expires_at" <= clock_timestamp())
      RETURNING GREATEST(
        0,
        CEIL(EXTRACT(EPOCH FROM (COALESCE("next_allowed_at", clock_timestamp()) - clock_timestamp())) * 1000)
      )::int AS "waitMs"
    `)
    const waitMs = rows[0]?.waitMs
    return waitMs === undefined ? null : { waitMs: Math.max(0, Number(waitMs)) }
  }

  private async isOwner(owner: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ owned: boolean }>>(Prisma.sql`
      SELECT (
        "lock_owner" = ${owner}::uuid
        AND "lock_expires_at" IS NOT NULL
        AND "lock_expires_at" > clock_timestamp()
      ) AS "owned"
      FROM "assistant_send_gates"
      WHERE "id" = ${GATE_ID}
    `)
    return rows[0]?.owned === true
  }

  private async release(owner: string, cooldownMs: number): Promise<void> {
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "assistant_send_gates"
        SET "next_allowed_at" = clock_timestamp() + make_interval(secs => ${cooldownMs / 1_000}),
            "lock_owner" = NULL,
            "lock_expires_at" = NULL,
            "updated_at" = clock_timestamp()
        WHERE "id" = ${GATE_ID}
          AND "lock_owner" = ${owner}::uuid
      `)
    }
    catch (error) {
      // 释放失败时保留租约到 TTL 结束，避免下一条消息立即发出；发送结果已经确定，不能回滚。
      this.logger.warn(`assistant send gate release failed: ${error instanceof Error ? error.name : 'unknown'}`)
    }
  }
}

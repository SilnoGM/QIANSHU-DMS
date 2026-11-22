import 'dotenv/config'

import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../src/config/assistant.config'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AssistantSendGateService } from '../src/modules/notifications/assistant-send-gate.service'

const GATE_ID = 'assistant-send'
const MIN_SEND_INTERVAL_MS = 200
const SEND_INTERVAL_JITTER_MS = 100

const configuration: AssistantConfiguration = {
  baseUrl: 'https://api.geweapi.com',
  token: 'test-token',
  workerEnabled: false,
  pollMs: 5_000,
  batchSize: 20,
  requestTimeoutMs: 1_000,
  minSendIntervalMs: MIN_SEND_INTERVAL_MS,
  sendIntervalJitterMs: 0,
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('AssistantSendGateService with PostgreSQL', () => {
  let prisma: PrismaService
  let gate: AssistantSendGateService

  async function resetGate(): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "assistant_send_gates"
      SET "next_allowed_at" = NULL,
          "lock_owner" = NULL,
          "lock_expires_at" = NULL,
          "updated_at" = clock_timestamp()
      WHERE "id" = ${GATE_ID}
    `
  }

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService())
    await prisma.onModuleInit()
    gate = new AssistantSendGateService(
      prisma,
      { get: () => configuration } as unknown as ConfigService,
    )
  })

  beforeEach(async () => {
    await resetGate()
  })

  afterAll(async () => {
    if (prisma !== undefined) {
      await resetGate().catch(() => undefined)
      await prisma.onModuleDestroy()
    }
  })

  it('serializes concurrent sends and waits after the previous send finishes', async () => {
    const starts: number[] = []
    let active = 0
    let maxActive = 0
    const send = async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      starts.push(Date.now())
      await sleep(30)
      active -= 1
    }

    await Promise.all([gate.run(send), gate.run(send)])

    expect(starts).toHaveLength(2)
    expect(maxActive).toBe(1)
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(MIN_SEND_INTERVAL_MS - 20)
  })

  it('keeps the cooldown when the previous send fails', async () => {
    const startedAt = Date.now()
    await expect(gate.run(() => Promise.reject(new Error('send failed')))).rejects.toThrow('send failed')

    let nextStartedAt = 0
    await gate.run(() => {
      nextStartedAt = Date.now()
      return Promise.resolve()
    })

    expect((nextStartedAt - startedAt)).toBeGreaterThanOrEqual(MIN_SEND_INTERVAL_MS - 20)
  })

  it('writes a jittered cooldown inside the configured interval range', async () => {
    const jitteredGate = new AssistantSendGateService(
      prisma,
      {
        get: () => ({ ...configuration, sendIntervalJitterMs: SEND_INTERVAL_JITTER_MS }),
      } as unknown as ConfigService,
    )
    const cooldowns: number[] = []

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await jitteredGate.run(() => Promise.resolve())
      // next_allowed_at 与 updated_at 在同一条 UPDATE 内写入，两者之差就是本次落库的冷却时间。
      const rows = await prisma.$queryRaw<Array<{ cooldownMs: number }>>`
        SELECT (EXTRACT(EPOCH FROM ("next_allowed_at" - "updated_at")) * 1000)::double precision AS "cooldownMs"
        FROM "assistant_send_gates"
        WHERE "id" = ${GATE_ID}
      `
      cooldowns.push(Number(rows[0]?.cooldownMs))
    }

    for (const cooldownMs of cooldowns) {
      expect(cooldownMs).toBeGreaterThanOrEqual(MIN_SEND_INTERVAL_MS - 1)
      expect(cooldownMs).toBeLessThanOrEqual(MIN_SEND_INTERVAL_MS + SEND_INTERVAL_JITTER_MS + 1)
    }
  })
})

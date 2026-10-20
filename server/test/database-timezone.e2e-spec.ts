import type { INestApplicationContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'

import { PrismaService } from '../src/infrastructure/database/prisma.service'

const DATABASE_TIME_ZONE_ERROR_MESSAGE = 'Database time zone must be UTC'
const PROBE_CURRENCY_CODE = 'ZZZ'
const ALLOWED_CLOCK_DRIFT_MS = 5_000

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  return value
}

function configFor(databaseUrl: string): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key !== 'DATABASE_URL') throw new Error('Unexpected configuration key')
      return databaseUrl
    },
  } as unknown as ConfigService
}

function databaseUrlWithSessionTimeZone(
  databaseUrl: string,
  timeZone: string,
): string {
  const url = new URL(databaseUrl)
  url.searchParams.set('options', `-c timezone=${timeZone}`)
  return url.toString()
}

async function createPrismaContext(
  databaseUrl: string,
): Promise<INestApplicationContext> {
  return Test.createTestingModule({
    providers: [
      PrismaService,
      { provide: ConfigService, useValue: configFor(databaseUrl) },
    ],
  }).compile()
}

describe('Database time zone', () => {
  const databaseUrl = requireDatabaseUrl()
  let context: INestApplicationContext | undefined
  let prisma: PrismaService

  beforeAll(async () => {
    context = await createPrismaContext(databaseUrl)
    await context.init()
    prisma = context.get(PrismaService)
  })

  afterAll(async () => {
    await context?.close()
    context = undefined
  })

  it('starts only with a UTC session time zone', async () => {
    const rows = await prisma.$queryRaw<Array<{ readonly timeZone: unknown }>>`
      SELECT current_setting('TimeZone') AS "timeZone"
    `

    expect(rows).toHaveLength(1)
    expect(['UTC', 'Etc/UTC']).toContain(rows[0]?.timeZone)
  })

  it('keeps Prisma-written timestamps aligned with the database clock', async () => {
    let driftMs = Number.POSITIVE_INFINITY

    await expect(prisma.$transaction(async (transaction) => {
      // 事务内写入并回滚，既验证写入链路，也不在测试库里留下币种夹具。
      await transaction.currency.deleteMany({
        where: { code: PROBE_CURRENCY_CODE },
      })
      await transaction.currency.create({
        data: { code: PROBE_CURRENCY_CODE, name: 'Timezone probe' },
      })
      const rows = await transaction.$queryRaw<Array<{
        readonly createdAt: Date
        readonly databaseNow: Date
      }>>`
        SELECT
          currency."created_at" AS "createdAt",
          clock_timestamp() AS "databaseNow"
        FROM "currencies" AS currency
        WHERE currency."code" = ${PROBE_CURRENCY_CODE}
      `
      const row = rows[0]
      if (!row) throw new Error('Timezone probe row was not created')
      driftMs = Math.abs(
        row.createdAt.getTime() - row.databaseNow.getTime(),
      )
      throw new Error('ROLLBACK')
    })).rejects.toThrow('ROLLBACK')

    expect(driftMs).toBeLessThan(ALLOWED_CLOCK_DRIFT_MS)
  })

  it('refuses to start when the session time zone is not UTC', async () => {
    const nonUtcContext = await createPrismaContext(
      databaseUrlWithSessionTimeZone(databaseUrl, 'Asia/Shanghai'),
    )

    try {
      await expect(nonUtcContext.init()).rejects.toThrow(
        DATABASE_TIME_ZONE_ERROR_MESSAGE,
      )
    } finally {
      await nonUtcContext.close().catch(() => undefined)
    }
  })
})

import { Logger } from '@nestjs/common'
import { HealthIndicatorService } from '@nestjs/terminus'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { DatabaseHealthIndicator } from './database-health.indicator'

type PrismaQuery = (
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
) => Promise<unknown>

function createIndicator() {
  const queryRaw = jest.fn<ReturnType<PrismaQuery>, Parameters<PrismaQuery>>()
  const up = jest.fn().mockReturnValue({ database: { status: 'up' } })
  const down = jest.fn().mockReturnValue({ database: { status: 'down' } })
  const check = jest.fn().mockReturnValue({ up, down })

  const prisma = {
    $queryRaw: queryRaw,
  } as unknown as PrismaService
  const healthIndicatorService = {
    check,
  } as unknown as HealthIndicatorService

  return {
    check,
    down,
    indicator: new DatabaseHealthIndicator(
      prisma,
      healthIndicatorService,
    ),
    queryRaw,
    up,
  }
}

describe('DatabaseHealthIndicator', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports the database as up after an exact SELECT 1 tagged query succeeds', async () => {
    const { check, down, indicator, queryRaw, up } = createIndicator()
    queryRaw.mockResolvedValue([{ '?column?': 1 }])

    await expect(indicator.isHealthy('database')).resolves.toEqual({
      database: { status: 'up' },
    })

    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith('database')
    expect(queryRaw).toHaveBeenCalledTimes(1)

    const [strings, ...values] = queryRaw.mock.calls[0] ?? []

    expect(Array.from(strings ?? [])).toEqual(['SELECT 1'])
    expect(Array.from(strings?.raw ?? [])).toEqual(['SELECT 1'])
    expect(values).toEqual([])
    expect(up).toHaveBeenCalledTimes(1)
    expect(up).toHaveBeenCalledWith()
    expect(down).not.toHaveBeenCalled()
  })

  it('reports only a sanitized down status when SELECT 1 fails', async () => {
    const queryCanary =
      'postgresql://unit-health-secret@localhost/qianshu_test'
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation()
    const consoleError = jest.spyOn(console, 'error').mockImplementation()
    const { check, down, indicator, queryRaw, up } = createIndicator()
    const originalError = new Error(queryCanary)
    queryRaw.mockRejectedValue(originalError)

    const result = await indicator.isHealthy('database')

    expect(result).toEqual({ database: { status: 'down' } })
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith('database')
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(down).toHaveBeenCalledTimes(1)
    expect(down).toHaveBeenCalledWith()
    expect(up).not.toHaveBeenCalled()
    expect(down.mock.calls.flat()).not.toContain(originalError)
    expect(JSON.stringify(result)).not.toContain(queryCanary)
    expect(loggerError).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })
})

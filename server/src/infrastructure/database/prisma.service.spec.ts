import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Pool } from 'pg'

import { PrismaService } from './prisma.service'

const DATABASE_SHUTDOWN_ERROR_MESSAGE = 'Database shutdown failed'
const DATABASE_INITIALIZATION_ERROR_MESSAGE = 'Database initialization failed'
const TEST_DATABASE_URL = 'postgresql://localhost:5432/qianshu_test'

type PoolWithPromiseEnd = {
  end: () => Promise<void>
}

function createService(): {
  configGetOrThrow: jest.Mock
  pool: Pool
  service: PrismaService
} {
  const configGetOrThrow = jest.fn().mockReturnValue(TEST_DATABASE_URL)
  const configService = {
    getOrThrow: configGetOrThrow,
  } as unknown as ConfigService
  const service = new PrismaService(configService)
  const pool = (service as unknown as { pool: Pool }).pool

  return { configGetOrThrow, pool, service }
}

function spyOnPoolEnd(pool: Pool) {
  return jest.spyOn(pool as unknown as PoolWithPromiseEnd, 'end')
}

async function captureShutdownError(service: PrismaService): Promise<Error> {
  try {
    await service.onModuleDestroy()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as Error
  }

  throw new Error('Expected database shutdown to fail')
}

async function captureInitializationError(
  service: PrismaService,
): Promise<Error> {
  try {
    await service.onModuleInit()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as Error
  }

  throw new Error('Expected database initialization to fail')
}

describe('PrismaService', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('builds one bounded external Pool from the configured database URL', () => {
    const { configGetOrThrow, pool } = createService()

    expect(configGetOrThrow).toHaveBeenCalledTimes(1)
    expect(configGetOrThrow).toHaveBeenCalledWith('DATABASE_URL')
    expect(pool.options).toEqual(
      expect.objectContaining({
        connectionString: TEST_DATABASE_URL,
        connectionTimeoutMillis: 5_000,
        max: 10,
        query_timeout: 5_000,
      }),
    )

    for (const value of [
      pool.options.max,
      pool.options.connectionTimeoutMillis,
      pool.options.query_timeout,
    ]) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('connects Prisma when the Nest module initializes', async () => {
    const { service } = createService()
    const connect = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined)

    await service.onModuleInit()

    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('releases both resources and throws only a safe error when initialization fails', async () => {
    const connectCanary = 'postgresql://connect-secret@localhost/test'
    const { pool, service } = createService()
    const callOrder: string[] = []
    const connect = jest.spyOn(service, '$connect').mockImplementation(() => {
      callOrder.push('$connect')
      return Promise.reject(new Error(connectCanary))
    })
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockImplementation(() => {
        callOrder.push('$disconnect')
        return Promise.resolve()
      })
    const end = spyOnPoolEnd(pool).mockImplementation(() => {
      callOrder.push('pool.end')
      return Promise.resolve()
    })

    const error = await captureInitializationError(service)

    expect(connect).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['$connect', '$disconnect', 'pool.end'])
    expect(error.message).toBe(DATABASE_INITIALIZATION_ERROR_MESSAGE)
    expect(error.stack).not.toContain(connectCanary)
    expect(error.cause).toBeUndefined()
  })

  it('hides cleanup failures after database initialization fails', async () => {
    const connectCanary = 'connect-sensitive-detail'
    const disconnectCanary = 'disconnect-sensitive-detail'
    const poolCanary = 'pool-sensitive-detail'
    const { pool, service } = createService()
    const connect = jest
      .spyOn(service, '$connect')
      .mockRejectedValue(new Error(connectCanary))
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockRejectedValue(new Error(disconnectCanary))
    const end = spyOnPoolEnd(pool).mockRejectedValue(new Error(poolCanary))

    const error = await captureInitializationError(service)

    expect(connect).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(error.message).toBe(DATABASE_INITIALIZATION_ERROR_MESSAGE)
    expect(error.stack).not.toContain(connectCanary)
    expect(error.stack).not.toContain(disconnectCanary)
    expect(error.stack).not.toContain(poolCanary)
    expect(error.cause).toBeUndefined()
  })

  it('disconnects Prisma before closing the external Pool', async () => {
    const { pool, service } = createService()
    const callOrder: string[] = []
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockImplementation(() => {
        callOrder.push('$disconnect')
        return Promise.resolve()
      })
    const end = spyOnPoolEnd(pool).mockImplementation(() => {
      callOrder.push('pool.end')
      return Promise.resolve()
    })

    await service.onModuleDestroy()

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['$disconnect', 'pool.end'])
  })

  it('closes the Pool and throws only a safe error when Prisma disconnect fails', async () => {
    const disconnectCanary = 'postgresql://disconnect-secret@localhost/test'
    const { pool, service } = createService()
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockRejectedValue(new Error(disconnectCanary))
    const end = spyOnPoolEnd(pool).mockResolvedValue(undefined)

    const error = await captureShutdownError(service)

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(error.message).toBe(DATABASE_SHUTDOWN_ERROR_MESSAGE)
    expect(error.stack).not.toContain(disconnectCanary)
    expect(error.cause).toBeUndefined()
  })

  it('throws only a safe error when the external Pool close fails', async () => {
    const poolCanary = 'postgresql://pool-secret@localhost/test'
    const { pool, service } = createService()
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined)
    const end = spyOnPoolEnd(pool).mockRejectedValue(new Error(poolCanary))

    const error = await captureShutdownError(service)

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(error.message).toBe(DATABASE_SHUTDOWN_ERROR_MESSAGE)
    expect(error.stack).not.toContain(poolCanary)
    expect(error.cause).toBeUndefined()
  })

  it('attempts both cleanup steps and hides both errors when both fail', async () => {
    const disconnectCanary = 'disconnect-sensitive-detail'
    const poolCanary = 'pool-sensitive-detail'
    const { pool, service } = createService()
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockRejectedValue(new Error(disconnectCanary))
    const end = spyOnPoolEnd(pool).mockRejectedValue(new Error(poolCanary))

    const error = await captureShutdownError(service)

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(error.message).toBe(DATABASE_SHUTDOWN_ERROR_MESSAGE)
    expect(error.stack).not.toContain(disconnectCanary)
    expect(error.stack).not.toContain(poolCanary)
    expect(error.cause).toBeUndefined()
  })

  it('logs only fixed text from its idle Pool error handler', () => {
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation()
    const { pool } = createService()
    const [idleErrorHandler] = pool.listeners('error')
    const canary = 'postgresql://idle-secret@localhost/test'

    expect(pool.listenerCount('error')).toBe(1)
    expect(idleErrorHandler).toBeDefined()

    if (!idleErrorHandler) {
      throw new Error('Expected an idle Pool error handler')
    }

    Reflect.apply(idleErrorHandler, pool, [new Error(canary)])

    expect(loggerError).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledWith(
      'PostgreSQL idle client emitted an error',
    )
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(canary)
  })
})

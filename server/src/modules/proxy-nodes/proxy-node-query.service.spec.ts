import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ProxyNodeQueryService } from './proxy-node-query.service'
import type { ProxyNodeSecretService } from './proxy-node-secret.service'

const DAY_MS = 86_400_000

type CountCall = [{
  where: {
    assignedUserId?: string
    expiresAt: { gt: Date, lte: Date }
  }
}]

function createFixture() {
  const count = jest.fn()
  const prisma = {
    proxyNode: { count },
  } as unknown as PrismaService
  const secret = {
    decrypt: jest.fn(),
  } as unknown as ProxyNodeSecretService

  return {
    service: new ProxyNodeQueryService(prisma, secret),
    count,
  }
}

function firstCountWhere(count: jest.Mock): CountCall[0]['where'] {
  const call = count.mock.calls[0] as CountCall | undefined
  if (call === undefined) {
    throw new Error('proxyNode.count was not called')
  }
  return call[0].where
}

describe('ProxyNodeQueryService expiry summary', () => {
  it('counts the current user nodes inside the next 48 hours', async () => {
    const fixture = createFixture()
    fixture.count.mockResolvedValue(3)

    await expect(fixture.service.expirySummaryMine('user-1'))
      .resolves.toEqual({ expiring2d: 3 })

    const where = firstCountWhere(fixture.count)
    expect(where.assignedUserId).toBe('user-1')
    expect(where.expiresAt.lte.getTime() - where.expiresAt.gt.getTime())
      .toBe(2 * DAY_MS)
  })

  it('counts all nodes for the management summary', async () => {
    const fixture = createFixture()
    fixture.count.mockResolvedValue(7)

    await expect(fixture.service.expirySummaryAll())
      .resolves.toEqual({ expiring2d: 7 })

    const where = firstCountWhere(fixture.count)
    expect(where.assignedUserId).toBeUndefined()
    expect(where.expiresAt.lte.getTime() - where.expiresAt.gt.getTime())
      .toBe(2 * DAY_MS)
  })
})

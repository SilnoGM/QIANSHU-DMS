import { ApiException } from '../../infrastructure/http/api.exception'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { IpfoxyClient, IpfoxyClientError } from './ipfoxy.client'
import { ProxyNodeCommandService } from './proxy-node-command.service'
import {
  ProxyNodeSecretService,
  ProxyNodeSecretUnavailableError,
} from './proxy-node-secret.service'

const TEST_PASSWORD = ['test', 'password', 'fixture'].join('-')

function vendorRecord(id: string): Record<string, unknown> {
  return {
    id,
    host: '203.0.113.10',
    port: '45001',
    type: 'socks5',
    area_id: '27',
    user: 'example-user',
    password: TEST_PASSWORD,
    auto_extend: '1',
    expire_time: '1701599163',
    buy_time: '1699007163',
    country_code: 'CL',
    ip_type: 'STATIC_DATACENTER',
    ip_version: 'IPv4',
  }
}

function createFixture() {
  const transaction = {
    $queryRaw: jest.fn(),
    proxyNode: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn(),
    },
  }
  const prisma = {
    $transaction: jest.fn(async (
      callback: (tx: typeof transaction) => Promise<unknown>,
    ) => callback(transaction)),
    proxyNode: {
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService
  const client = {
    listProxies: jest.fn(),
    listAreas: jest.fn().mockResolvedValue([{ id: 27, country: '智利' }]),
  }
  const secret = {
    encrypt: jest.fn((plaintext: string) => `encrypted:${plaintext}`),
    decrypt: jest.fn(),
  }
  const audit = {
    record: jest.fn().mockResolvedValue({}),
  }

  return {
    service: new ProxyNodeCommandService(
      prisma,
      client as unknown as IpfoxyClient,
      secret as unknown as ProxyNodeSecretService,
      audit,
    ),
    transaction,
    prisma,
    client,
    secret,
    audit,
  }
}

async function expectApiError(
  action: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  let thrown: unknown
  try {
    await action
  }
  catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ApiException)
  expect((thrown as ApiException).getStatus()).toBe(status)
  expect((thrown as ApiException).code).toBe(code)
}

function firstUpsertArg(mock: jest.Mock): Record<string, unknown> {
  const call = mock.mock.calls[0] as [Record<string, unknown>] | undefined
  return call?.[0] ?? {}
}

function firstCallArg(mock: jest.Mock): Record<string, unknown> {
  const call = mock.mock.calls[0] as [Record<string, unknown>] | undefined
  return call?.[0] ?? {}
}

describe('ProxyNodeCommandService', () => {
  describe('sync', () => {
    it('upserts valid nodes, marks missing ones and audits the batch', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([{ locked: true }])
      fixture.client.listProxies.mockResolvedValue([
        vendorRecord('a'),
        vendorRecord('b'),
      ])
      fixture.transaction.proxyNode.findMany.mockResolvedValue([
        { providerProxyId: 'a' },
      ])
      fixture.transaction.proxyNode.count.mockResolvedValue(1)

      const result = await fixture.service.sync({
        actorUserId: 'actor',
        requestId: 'request',
      })

      expect(result).toMatchObject({
        created: 1,
        updated: 1,
        skipped: 0,
        vendorMissing: 1,
      })
      expect(fixture.transaction.proxyNode.updateMany)
        .toHaveBeenCalledWith({ data: { vendorMissing: true } })
      expect(fixture.transaction.proxyNode.upsert).toHaveBeenCalledTimes(2)
      expect(firstUpsertArg(fixture.transaction.proxyNode.upsert))
        .toMatchObject({
          where: { providerProxyId: 'a' },
          create: { providerProxyId: 'a', vendorCountry: '智利' },
        })
      expect(fixture.secret.encrypt).toHaveBeenCalledWith(TEST_PASSWORD)
      expect(fixture.audit.record).toHaveBeenCalledWith(
        fixture.transaction,
        expect.objectContaining({
          eventType: 'PROXY_NODE_SYNCED',
          metadata: { created: 1, updated: 1, skipped: 0, vendorMissing: 1 },
        }),
      )
    })

    it('skips invalid records without failing the batch', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([{ locked: true }])
      fixture.client.listProxies.mockResolvedValue([
        vendorRecord('a'),
        vendorRecord('bad'),
        { ...vendorRecord('bad2'), port: '0' },
      ])

      const result = await fixture.service.sync({
        actorUserId: 'actor',
        requestId: 'request',
      })

      expect(result.skipped).toBe(1)
      expect(result.warnings[0]).toContain('bad2')
      expect(fixture.transaction.proxyNode.upsert).toHaveBeenCalledTimes(2)
    })

    it('keeps existing vendor country when area query fails', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([{ locked: true }])
      fixture.client.listProxies.mockResolvedValue([vendorRecord('a')])
      fixture.client.listAreas.mockRejectedValue(
        new IpfoxyClientError('UNAVAILABLE'),
      )
      fixture.transaction.proxyNode.findMany.mockResolvedValue([
        { providerProxyId: 'a' },
      ])

      const result = await fixture.service.sync({
        actorUserId: 'actor',
        requestId: 'request',
      })

      expect(result.warnings[0]).toContain('地区列表查询失败')
      expect(firstUpsertArg(fixture.transaction.proxyNode.upsert).update)
        .not.toHaveProperty('vendorCountry')
    })

    it('maps provider and secret failures to stable API errors', async () => {
      const fixture = createFixture()
      fixture.client.listProxies.mockRejectedValue(
        new IpfoxyClientError('UNAUTHORIZED'),
      )
      await expectApiError(
        fixture.service.sync({ actorUserId: 'actor', requestId: 'request' }),
        503,
        'PROXY_PROVIDER_UNAUTHORIZED',
      )

      fixture.client.listProxies.mockResolvedValue([vendorRecord('a')])
      fixture.transaction.$queryRaw.mockResolvedValue([{ locked: true }])
      fixture.secret.encrypt.mockImplementation(() => {
        throw new ProxyNodeSecretUnavailableError()
      })
      await expectApiError(
        fixture.service.sync({ actorUserId: 'actor', requestId: 'request' }),
        503,
        'PROXY_NODE_SECRET_UNAVAILABLE',
      )
    })

    it('preserves local data when the vendor returns an empty list', async () => {
      const fixture = createFixture()
      const prismaMock = fixture.prisma as unknown as {
        $transaction: jest.Mock
        proxyNode: { count: jest.Mock }
      }
      fixture.client.listProxies.mockResolvedValue([])
      prismaMock.proxyNode.count.mockResolvedValue(3)

      await expectApiError(
        fixture.service.sync({ actorUserId: 'actor', requestId: 'request' }),
        503,
        'PROXY_PROVIDER_INVALID_RESPONSE',
      )
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('rejects a concurrent sync before fetching again', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([{ locked: true }])
      let release: (() => void) | undefined
      fixture.client.listProxies.mockImplementation(() => new Promise((resolve) => {
        release = () => resolve([])
      }))

      const first = fixture.service.sync({
        actorUserId: 'actor',
        requestId: 'request',
      })
      await expectApiError(
        fixture.service.sync({ actorUserId: 'actor', requestId: 'request' }),
        409,
        'PROXY_SYNC_IN_PROGRESS',
      )

      release?.()
      await first
    })
  })

  describe('assign', () => {
    const nodeRow = {
      id: 'proxy-id',
      provider_proxy_id: 'a',
      assigned_user_id: null,
      assigned_at: null,
      expires_at: new Date(Date.now() + 86_400_000),
      vendor_missing: false,
    }

    it('assigns an active user and writes an audit event', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([nodeRow])
      fixture.transaction.user.findUnique.mockResolvedValue({ status: 'ACTIVE' })

      const result = await fixture.service.assign(
        nodeRow.id,
        { userId: 'user-1' },
        { actorUserId: 'actor', requestId: 'request' },
      )

      expect(result.assignedUserId).toBe('user-1')
      expect(firstCallArg(fixture.transaction.proxyNode.update)).toMatchObject({
        where: { id: nodeRow.id },
        data: {
          assignedUserId: 'user-1',
          assignedByUserId: 'actor',
        },
      })
      expect(fixture.audit.record).toHaveBeenCalledWith(
        fixture.transaction,
        expect.objectContaining({ eventType: 'PROXY_NODE_ASSIGNED' }),
      )
    })

    it('rejects an occupied node unless replace is explicit', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([
        { ...nodeRow, assigned_user_id: 'other-user' },
      ])
      fixture.transaction.user.findUnique.mockResolvedValue({ status: 'ACTIVE' })

      await expectApiError(
        fixture.service.assign(
          nodeRow.id,
          { userId: 'user-1' },
          { actorUserId: 'actor', requestId: 'request' },
        ),
        409,
        'PROXY_NODE_ALREADY_ASSIGNED',
      )

      await fixture.service.assign(
        nodeRow.id,
        { userId: 'user-1', replace: true },
        { actorUserId: 'actor', requestId: 'request' },
      )
      expect(fixture.transaction.proxyNode.update).toHaveBeenCalled()
    })

    it('rejects expired, missing and inactive targets', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([
        { ...nodeRow, expires_at: new Date(Date.now() - 1) },
      ])
      await expectApiError(
        fixture.service.assign(
          nodeRow.id,
          { userId: 'user-1' },
          { actorUserId: 'actor', requestId: 'request' },
        ),
        409,
        'PROXY_NODE_EXPIRED',
      )

      fixture.transaction.$queryRaw.mockResolvedValue([
        { ...nodeRow, vendor_missing: true },
      ])
      await expectApiError(
        fixture.service.assign(
          nodeRow.id,
          { userId: 'user-1' },
          { actorUserId: 'actor', requestId: 'request' },
        ),
        409,
        'PROXY_NODE_UNAVAILABLE',
      )

      fixture.transaction.$queryRaw.mockResolvedValue([nodeRow])
      fixture.transaction.user.findUnique.mockResolvedValue({ status: 'DISABLED' })
      await expectApiError(
        fixture.service.assign(
          nodeRow.id,
          { userId: 'user-1' },
          { actorUserId: 'actor', requestId: 'request' },
        ),
        422,
        'PROXY_NODE_ASSIGNEE_INVALID',
      )
    })

    it('is idempotent for the same assignee', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([
        {
          ...nodeRow,
          assigned_user_id: 'user-1',
          assigned_at: new Date('2026-11-01T00:00:00.000Z'),
        },
      ])
      fixture.transaction.user.findUnique.mockResolvedValue({ status: 'ACTIVE' })

      const result = await fixture.service.assign(
        nodeRow.id,
        { userId: 'user-1' },
        { actorUserId: 'actor', requestId: 'request' },
      )

      expect(result.assignedAt).toBe('2026-11-01T00:00:00.000Z')
      expect(fixture.transaction.proxyNode.update).not.toHaveBeenCalled()
      expect(fixture.audit.record).not.toHaveBeenCalled()
    })
  })

  describe('release', () => {
    it('clears the assignment and audits the previous user', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([{
        id: 'proxy-id',
        provider_proxy_id: 'a',
        assigned_user_id: 'user-1',
        assigned_at: new Date(),
        expires_at: new Date(Date.now() + 86_400_000),
        vendor_missing: false,
      }])

      const result = await fixture.service.release(
        'proxy-id',
        { actorUserId: 'actor', requestId: 'request' },
      )

      expect(result.id).toBe('proxy-id')
      expect(fixture.transaction.proxyNode.update).toHaveBeenCalledWith({
        where: { id: 'proxy-id' },
        data: {
          assignedUserId: null,
          assignedAt: null,
          assignedByUserId: null,
        },
      })
      expect(fixture.audit.record).toHaveBeenCalledWith(
        fixture.transaction,
        expect.objectContaining({
          eventType: 'PROXY_NODE_RELEASED',
          metadata: {
            providerProxyId: 'a',
            previousAssignedUserId: 'user-1',
          },
        }),
      )
    })

    it('rejects unknown and unassigned nodes', async () => {
      const fixture = createFixture()
      fixture.transaction.$queryRaw.mockResolvedValue([])
      await expectApiError(
        fixture.service.release(
          'proxy-id',
          { actorUserId: 'actor', requestId: 'request' },
        ),
        404,
        'PROXY_NODE_NOT_FOUND',
      )

      fixture.transaction.$queryRaw.mockResolvedValue([{
        id: 'proxy-id',
        provider_proxy_id: 'a',
        assigned_user_id: null,
        assigned_at: null,
        expires_at: new Date(Date.now() + 86_400_000),
        vendor_missing: false,
      }])
      await expectApiError(
        fixture.service.release(
          'proxy-id',
          { actorUserId: 'actor', requestId: 'request' },
        ),
        409,
        'PROXY_NODE_NOT_ASSIGNED',
      )
    })
  })
})

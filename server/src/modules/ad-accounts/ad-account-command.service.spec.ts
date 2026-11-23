import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import { AdAccountCommandService } from './ad-account-command.service'

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333'
const ACTOR_ID = '44444444-4444-4444-8444-444444444444'

function createService(options: {
  account?: { id: string, accountId: string, assignedUserId: string | null } | null
  assignee?: { id: string, status: string } | null
  updatedCount?: number
}) {
  const findAccount = jest
    .fn<Promise<{ id: string, accountId: string, assignedUserId: string | null } | null>, [unknown]>()
    .mockResolvedValue(options.account === undefined ? {
      id: ACCOUNT_ID,
      accountId: '183000000000097',
      assignedUserId: null,
    } : options.account)
  const findUser = jest
    .fn<Promise<{ id: string, status: string } | null>, [unknown]>()
    .mockResolvedValue(options.assignee === undefined
      ? { id: USER_ID, status: 'ACTIVE' }
      : options.assignee)
  const updateMany = jest
    .fn<Promise<{ count: number }>, [unknown]>()
    .mockResolvedValue({ count: options.updatedCount ?? 1 })

  const transaction = {
    adAccount: { findUnique: findAccount, updateMany },
    user: { findUnique: findUser },
  }

  const transactionRunner = jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>()
  transactionRunner.mockImplementation((callback) => Promise.resolve(callback(transaction)))

  const prisma = { $transaction: transactionRunner } as unknown as PrismaService

  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue(undefined),
  } as unknown as AuditService

  return {
    service: new AdAccountCommandService(prisma, audit),
    audit,
    updateMany,
  }
}

describe('AdAccountCommandService.assign', () => {
  it('binds an unassigned account and records an audit event', async () => {
    const { service, audit, updateMany } = createService({})

    await expect(service.assign(ACCOUNT_ID, { userId: USER_ID }, { actorUserId: ACTOR_ID }))
      .resolves.toEqual({ assignedUserId: USER_ID })

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ACCOUNT_ID, assignedUserId: null },
      data: expect.objectContaining({
        assignedUserId: USER_ID,
        assignedByUserId: ACTOR_ID,
        assignedAt: expect.any(Date) as unknown,
      }) as unknown,
    }))
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'AD_ACCOUNT_ASSIGNED',
      actorUserId: ACTOR_ID,
      metadata: expect.objectContaining({ assignedUserId: USER_ID, previousAssignedUserId: '' }) as unknown,
    }))
  })

  it('is idempotent when the account is already bound to the same user', async () => {
    const { service, audit, updateMany } = createService({
      account: { id: ACCOUNT_ID, accountId: '183000000000097', assignedUserId: USER_ID },
    })

    await expect(service.assign(ACCOUNT_ID, { userId: USER_ID }, { actorUserId: ACTOR_ID }))
      .resolves.toEqual({ assignedUserId: USER_ID })

    expect(updateMany).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects rebinding another user without replace', async () => {
    const { service, updateMany } = createService({
      account: { id: ACCOUNT_ID, accountId: '183000000000097', assignedUserId: OTHER_USER_ID },
    })

    await expect(service.assign(ACCOUNT_ID, { userId: USER_ID }, { actorUserId: ACTOR_ID }))
      .rejects.toMatchObject({ code: 'AD_ACCOUNT_ALREADY_ASSIGNED' })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('allows rebinding with replace and keeps the previous assignee in audit', async () => {
    const { service, audit } = createService({
      account: { id: ACCOUNT_ID, accountId: '183000000000097', assignedUserId: OTHER_USER_ID },
    })

    await service.assign(ACCOUNT_ID, { userId: USER_ID, replace: true }, { actorUserId: ACTOR_ID })

    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      metadata: expect.objectContaining({ previousAssignedUserId: OTHER_USER_ID }) as unknown,
    }))
  })

  it('rejects an inactive assignee', async () => {
    const { service } = createService({ assignee: { id: USER_ID, status: 'DISABLED' } })

    await expect(service.assign(ACCOUNT_ID, { userId: USER_ID }, { actorUserId: ACTOR_ID }))
      .rejects.toMatchObject({ code: 'AD_ACCOUNT_ASSIGNEE_INVALID' })
  })

  it('rejects an unknown assignee', async () => {
    const { service } = createService({ assignee: null })

    await expect(service.assign(ACCOUNT_ID, { userId: USER_ID }, { actorUserId: ACTOR_ID }))
      .rejects.toMatchObject({ code: 'AD_ACCOUNT_ASSIGNEE_INVALID' })
  })

  it('reports a missing account', async () => {
    const { service } = createService({ account: null })

    await expect(service.assign(ACCOUNT_ID, { userId: USER_ID }, { actorUserId: ACTOR_ID }))
      .rejects.toMatchObject({ code: 'AD_ACCOUNT_NOT_FOUND' })
  })

  it('reports a concurrent state change when the conditional update misses', async () => {
    const { service } = createService({ updatedCount: 0 })

    await expect(service.assign(ACCOUNT_ID, { userId: USER_ID }, { actorUserId: ACTOR_ID }))
      .rejects.toMatchObject({ code: 'AD_ACCOUNT_STATE_CHANGED' })
  })
})

describe('AdAccountCommandService.release', () => {
  it('clears all three assignment columns and records an audit event', async () => {
    const { service, audit, updateMany } = createService({
      account: { id: ACCOUNT_ID, accountId: '183000000000097', assignedUserId: USER_ID },
    })

    await expect(service.release(ACCOUNT_ID, { actorUserId: ACTOR_ID }))
      .resolves.toEqual({ released: true })

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: ACCOUNT_ID, assignedUserId: USER_ID },
      data: { assignedUserId: null, assignedAt: null, assignedByUserId: null },
    })
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'AD_ACCOUNT_RELEASED',
      metadata: expect.objectContaining({ previousAssignedUserId: USER_ID }) as unknown,
    }))
  })

  it('rejects releasing an unassigned account', async () => {
    const { service } = createService({})

    await expect(service.release(ACCOUNT_ID, { actorUserId: ACTOR_ID }))
      .rejects.toMatchObject({ code: 'AD_ACCOUNT_NOT_ASSIGNED' })
  })
})

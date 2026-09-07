import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import type { Prisma } from '../../generated/prisma/client'

import {
  AuditEventValidationError,
  AuditService,
  AuditWriteFailedError,
  MAX_AUDIT_METADATA_STRING_LENGTH,
} from './audit.service'

const ACTOR_USER_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const SOURCE_IP_HASH = Buffer.alloc(32, 0x22)

interface TransactionFixture {
  transaction: Prisma.TransactionClient
  create: jest.Mock<
    Promise<Record<string, unknown>>,
    [{ data: Record<string, unknown> }]
  >
}

function createTransactionFixture(): TransactionFixture {
  const create = jest.fn<
    Promise<Record<string, unknown>>,
    [{ data: Record<string, unknown> }]
  >(args =>
    Promise.resolve({
      id: 'c277ef16-894a-472a-b2f4-33a4bfc21d00',
      ...args.data,
    }),
  )

  return {
    transaction: {
      auditEvent: { create },
    } as unknown as Prisma.TransactionClient,
    create,
  }
}

describe('AuditService', () => {
  it('only permits bounded UUID issuance arrays on purchase creation', async () => {
    const { transaction, create } = createTransactionFixture()
    const service = new AuditService()
    const metadata = { partCount: 1000, shippingMarkIssuanceIds: Array<string>(1000).fill(ACTOR_USER_ID) }
    const base = { actorType: AuditActorType.USER, actorUserId: ACTOR_USER_ID, outcome: AuditOutcome.SUCCESS }
    await expect(service.record(transaction, { ...base, eventType: AuditEventType.PURCHASE_ORDER_CREATED, metadata })).resolves.toBeDefined()
    expect(create).toHaveBeenCalledTimes(1)
    await expect(service.record(transaction, { ...base, eventType: AuditEventType.USER_PASSWORD_RESET, metadata })).rejects.toBeInstanceOf(AuditEventValidationError)
    await expect(service.record(transaction, { ...base, eventType: AuditEventType.PURCHASE_ORDER_CREATED,
      metadata: { shippingMarkIssuanceIds: ['invalid'] } })).rejects.toBeInstanceOf(AuditEventValidationError)
    await expect(service.record(transaction, { ...base, eventType: AuditEventType.PURCHASE_ORDER_CREATED,
      metadata: { shippingMarkIssuanceIds: Array<string>(1001).fill(ACTOR_USER_ID) } })).rejects.toBeInstanceOf(AuditEventValidationError)
  })
  it('使用调用方 TransactionClient 写入结构化审计，并复制可变输入', async () => {
    const { transaction, create } = createTransactionFixture()
    const service = new AuditService()
    const metadata = {
      mustChangePassword: true,
      changedFieldCount: 2,
      source: 'admin',
      note: null,
    }
    const sourceIpHash = Buffer.from(SOURCE_IP_HASH)

    await service.record(transaction, {
      eventType: AuditEventType.USER_PASSWORD_RESET,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_USER_ID,
      targetType: 'User',
      targetId: ACTOR_USER_ID,
      requestId: 'req-123',
      correlationId: 'correlation-123',
      reasonCode: 'ADMIN_REQUEST',
      sourceIpHash,
      metadata,
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        eventType: AuditEventType.USER_PASSWORD_RESET,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: ACTOR_USER_ID,
        targetType: 'User',
        targetId: ACTOR_USER_ID,
        requestId: 'req-123',
        correlationId: 'correlation-123',
        reasonCode: 'ADMIN_REQUEST',
        sourceIpHash: SOURCE_IP_HASH,
        metadata,
      },
    })

    const writtenData = create.mock.calls[0]?.[0].data as {
      sourceIpHash: Buffer
      metadata: Record<string, unknown>
    }
    expect(writtenData.sourceIpHash).not.toBe(sourceIpHash)
    expect(writtenData.metadata).not.toBe(metadata)

    sourceIpHash.fill(0xff)
    metadata.source = 'mutated-after-call'
    expect(writtenData.sourceIpHash).toEqual(SOURCE_IP_HASH)
    expect(writtenData.metadata.source).toBe('admin')
  })

  it('省略 requestId 时生成满足数据库长度约束的安全标识', async () => {
    const { transaction, create } = createTransactionFixture()
    const service = new AuditService()

    await service.record(transaction, {
      eventType: AuditEventType.SYSTEM_BOOTSTRAP,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.SYSTEM,
    })

    const data = create.mock.calls[0]?.[0].data
    expect(data.requestId).toEqual(expect.any(String))
    expect((data.requestId as string).length).toBeLessThanOrEqual(64)
    expect(data.actorUserId).toBeNull()
    expect(data.sourceIpHash).toBeNull()
    expect(data.metadata).toEqual({})
  })

  it.each([
    ['password', { password: 'do-not-store' }],
    ['mixed-case token', { accessToKeN: 'do-not-store' }],
    ['cookie', { session_cookie: 'do-not-store' }],
    ['secret', { clientSecret: 'do-not-store' }],
    ['authorization', { Authorization: 'do-not-store' }],
    ['session', { sessionId: 'do-not-store' }],
  ])('拒绝敏感 metadata 键：%s', async (_description, metadata) => {
    const { transaction, create } = createTransactionFixture()
    const service = new AuditService()

    const operation = service.record(transaction, {
      eventType: AuditEventType.AUTH_LOGIN_FAILED,
      outcome: AuditOutcome.FAILURE,
      actorType: AuditActorType.ANONYMOUS,
      metadata,
    })

    await expect(operation).rejects.toBeInstanceOf(AuditEventValidationError)
    await expect(operation).rejects.toMatchObject({
      code: 'AUDIT_EVENT_INVALID',
      message: 'Audit event is invalid',
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('仅允许 mustChangePassword 作为布尔流程状态，不能借该键保存文本', async () => {
    const { transaction, create } = createTransactionFixture()
    const service = new AuditService()

    await expect(
      service.record(transaction, {
        eventType: AuditEventType.USER_PASSWORD_RESET,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: ACTOR_USER_ID,
        metadata: {
          mustChangePassword: 'do-not-store-password-like-text',
        },
      }),
    ).rejects.toBeInstanceOf(AuditEventValidationError)
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    ['nested object', { nested: { value: true } }],
    ['array', { values: ['one'] }],
    ['undefined', { value: undefined }],
    ['non-finite number', { value: Number.POSITIVE_INFINITY }],
    [
      'overlong string',
      { value: 'a'.repeat(MAX_AUDIT_METADATA_STRING_LENGTH + 1) },
    ],
  ])('拒绝非扁平或过长 metadata 值：%s', async (_description, metadata) => {
    const { transaction } = createTransactionFixture()
    const service = new AuditService()

    await expect(
      service.record(transaction, {
        eventType: AuditEventType.USER_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: ACTOR_USER_ID,
        metadata: metadata as never,
      }),
    ).rejects.toBeInstanceOf(AuditEventValidationError)
  })

  it('仅为销售产品修改审计接受受限数组和对象数组', async () => {
    const { transaction, create } = createTransactionFixture()
    const service = new AuditService()

    await expect(service.record(transaction, {
      eventType: AuditEventType.SALES_ORDER_PRODUCTS_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_USER_ID,
      metadata: {
        addedLineIds: ['11111111-1111-4111-8111-111111111111'],
        quantityChanges: [{
          lineId: '22222222-2222-4222-8222-222222222222',
          from: 2,
          to: 3,
        }],
        removedLineIds: [],
      },
    })).resolves.toBeDefined()
    const written = create.mock.calls[0]?.[0]
    expect(written?.data).toMatchObject({
      metadata: {
        addedLineIds: ['11111111-1111-4111-8111-111111111111'],
        quantityChanges: [{
          lineId: '22222222-2222-4222-8222-222222222222',
          from: 2,
          to: 3,
        }],
        removedLineIds: [],
      },
    })
  })

  it('拒绝销售产品修改结构化审计中的敏感键', async () => {
    const { transaction } = createTransactionFixture()
    const service = new AuditService()

    await expect(service.record(transaction, {
      eventType: AuditEventType.SALES_ORDER_PRODUCTS_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_USER_ID,
      metadata: {
        quantityChanges: [{ password: 'must-not-pass' }],
      },
    })).rejects.toBeInstanceOf(AuditEventValidationError)
  })

  it.each([
    [
      'USER actor without actorUserId',
      {
        actorType: AuditActorType.USER,
      },
    ],
    [
      'ANONYMOUS actor with actorUserId',
      {
        actorType: AuditActorType.ANONYMOUS,
        actorUserId: ACTOR_USER_ID,
      },
    ],
    [
      'SYSTEM actor with actorUserId',
      {
        actorType: AuditActorType.SYSTEM,
        actorUserId: ACTOR_USER_ID,
      },
    ],
    [
      'invalid sourceIpHash length',
      {
        actorType: AuditActorType.ANONYMOUS,
        sourceIpHash: Buffer.alloc(31),
      },
    ],
  ])('在服务边界遵守 AuditEvent schema：%s', async (_description, input) => {
    const { transaction, create } = createTransactionFixture()
    const service = new AuditService()

    await expect(
      service.record(transaction, {
        eventType: AuditEventType.AUTH_LOGIN_FAILED,
        outcome: AuditOutcome.FAILURE,
        ...input,
      }),
    ).rejects.toBeInstanceOf(AuditEventValidationError)
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    ['requestId', { requestId: 'a'.repeat(65) }],
    ['targetType', { targetType: 'a'.repeat(129) }],
    ['targetId', { targetId: 'a'.repeat(129) }],
    ['correlationId', { correlationId: 'a'.repeat(129) }],
    ['reasonCode', { reasonCode: 'a'.repeat(129) }],
  ])('拒绝超过数据库列长度的 %s', async (_field, input) => {
    const { transaction } = createTransactionFixture()
    const service = new AuditService()

    await expect(
      service.record(transaction, {
        eventType: AuditEventType.AUTH_LOGIN_FAILED,
        outcome: AuditOutcome.FAILURE,
        actorType: AuditActorType.ANONYMOUS,
        ...input,
      }),
    ).rejects.toBeInstanceOf(AuditEventValidationError)
  })

  it('拒绝通过类型断言传入的未知 Prisma enum 值', async () => {
    const { transaction, create } = createTransactionFixture()
    const service = new AuditService()

    await expect(
      service.record(transaction, {
        eventType: 'UNKNOWN_EVENT' as AuditEventType,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.SYSTEM,
      }),
    ).rejects.toBeInstanceOf(AuditEventValidationError)
    expect(create).not.toHaveBeenCalled()
  })

  it('将数据库错误转换为固定安全错误且不泄露底层敏感内容', async () => {
    const unsafeValue = 'database-error-containing-secret-value'
    const { transaction, create } = createTransactionFixture()
    create.mockRejectedValueOnce(new Error(unsafeValue))
    const service = new AuditService()

    const operation = service.record(transaction, {
      eventType: AuditEventType.AUTH_LOGIN_FAILED,
      outcome: AuditOutcome.FAILURE,
      actorType: AuditActorType.ANONYMOUS,
    })

    await expect(operation).rejects.toBeInstanceOf(AuditWriteFailedError)
    await expect(operation).rejects.toMatchObject({
      code: 'AUDIT_WRITE_FAILED',
      message: 'Audit event write failed',
    })
    expect(JSON.stringify(await operation.catch((error: unknown) => error))).not.toContain(
      unsafeValue,
    )
  })
})

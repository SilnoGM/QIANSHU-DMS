/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言调用参数。 */
import { ApiException } from '../../infrastructure/http/api.exception'
import type { AuditService } from '../audit/audit.service'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import type {
  CreateMachineViewingDto,
  MachineViewingDto,
  UpdateMachineViewingDto,
} from './machine-viewing.dto'
import { MachineViewingService } from './machine-viewing.service'
import { MachineViewingQueryService } from './machine-viewing-query.service'

const ACTOR = 'c1a2b3c4-d5e6-47f8-9a0b-c1d2e3f4a5b6'
const REQUEST_ID = 'req_11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const CREATED_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a'
const ISSUANCE_ID = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b'
const NOW = new Date('2026-11-05T02:00:00.000Z')

const INPUT: CreateMachineViewingDto = {
  site: 'NEW_TAIPEI_LINKOU',
  machineType: 'MINI_TILLER',
  appointmentMonth: 11,
  appointmentDay: 5,
  period: 'PM',
  hour: 3,
  customerName: ' 陈先生 ',
  customerPhone: ' 0912-345-678 ',
  contactPerson: '李华',
}

function dto(overrides: Partial<MachineViewingDto> = {}): MachineViewingDto {
  return {
    id: CREATED_ID,
    appointmentNo: 'MV/20261106-0001',
    site: 'NEW_TAIPEI_LINKOU',
    machineType: 'MINI_TILLER',
    appointmentDate: '2026-11-05',
    period: 'PM',
    hour: 3,
    customerName: '陈先生',
    customerPhone: '0912-345-678',
    contactPerson: '李华',
    status: 'PENDING_APPOINTMENT',
    feedback: null,
    createdBy: { id: ACTOR, name: '测试运营', avatarUrl: null },
    createdAt: '2026-11-05T02:00:00.000Z',
    ...overrides,
  }
}

function createHarness(options: {
  readonly previous?: Record<string, unknown> | null
  readonly existing?: Record<string, unknown> | null
  readonly dto?: MachineViewingDto
  readonly canViewAll?: boolean
} = {}) {
  const appointment = {
    findUnique: jest.fn().mockResolvedValue(options.previous ?? null),
    findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn<Promise<{ id: string }>, [{ data: Record<string, unknown>, select: { id: true } }]>()
      .mockResolvedValue({ id: CREATED_ID }),
  }
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{}]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    userRole: {
      findFirst: jest.fn().mockResolvedValue(options.canViewAll === true ? { userId: ACTOR } : null),
    },
    machineViewingAppointment: appointment,
  }
  const prisma = {
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(transaction)),
  }
  const queries = {
    findById: jest.fn().mockResolvedValue(options.dto ?? dto()),
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, Record<string, unknown>]>().mockResolvedValue({}),
  }
  const numbering = {
    generateScopedInTransaction: jest.fn<
      Promise<{ number: string, issuanceId: string }>,
      [unknown, Record<string, unknown>]
    >().mockResolvedValue({
      number: 'MV/20261106-0001',
      issuanceId: ISSUANCE_ID,
    }),
  }
  const service = new MachineViewingService(
    prisma as never,
    queries as unknown as MachineViewingQueryService,
    audit as unknown as AuditService,
    numbering as unknown as NumberingGeneratorService,
  )
  return { service, appointment, transaction, queries, audit, numbering }
}

describe('MachineViewingService.create', () => {
  it('normalizes input, issues a number and writes audit in the same transaction', async () => {
    const { service, appointment, audit, transaction, numbering } = createHarness()

    await expect(service.create({ actorUserId: ACTOR, requestId: REQUEST_ID }, INPUT, IDEMPOTENCY_KEY, NOW))
      .resolves.toEqual(dto())

    expect(transaction.$queryRaw).toHaveBeenCalled()
    expect(transaction.$executeRaw).toHaveBeenCalled()

    const numberingArg = numbering.generateScopedInTransaction.mock.calls[0]?.[1]
    expect(numberingArg).toMatchObject({
      ruleCode: 'MACHINE_VIEWING_NO',
      consumerCode: 'MACHINE_VIEWING.CREATE',
      idempotencyKey: `${ACTOR}:${IDEMPOTENCY_KEY}`,
    })
    expect(numberingArg?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u)

    const createArg = appointment.create.mock.calls[0]?.[0]
    expect(createArg?.data).toMatchObject({
      appointmentNo: 'MV/20261106-0001',
      numberingIssuanceId: ISSUANCE_ID,
      site: 'NEW_TAIPEI_LINKOU',
      machineType: 'MINI_TILLER',
      appointmentDate: new Date('2026-11-05T00:00:00.000Z'),
      period: 'PM',
      hour: 3,
      customerName: '陈先生',
      customerPhone: '0912-345-678',
      contactPerson: '李华',
      createdByUserId: ACTOR,
    })
    expect(createArg?.select).toEqual({ id: true })

    const auditInput = audit.record.mock.calls[0]?.[1]
    expect(auditInput).toMatchObject({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_CREATED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: ACTOR,
      requestId: REQUEST_ID,
      targetType: 'MACHINE_VIEWING_APPOINTMENT',
      targetId: CREATED_ID,
      metadata: {
        appointmentDate: '2026-11-05',
        customerName: '陈先生',
      },
    })
  })

  it('returns the existing appointment on an identical replay without creating or auditing again', async () => {
    const { service, appointment, audit, queries } = createHarness({
      previous: {
        id: CREATED_ID,
        site: 'NEW_TAIPEI_LINKOU',
        machineType: 'MINI_TILLER',
        appointmentDate: new Date('2026-11-05T00:00:00.000Z'),
        period: 'PM',
        hour: 3,
        customerName: '陈先生',
        customerPhone: '0912-345-678',
        contactPerson: '李华',
      },
    })

    await expect(service.create({ actorUserId: ACTOR, requestId: REQUEST_ID }, INPUT, IDEMPOTENCY_KEY, NOW))
      .resolves.toEqual(dto())

    expect(appointment.create).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
    expect(queries.findById).toHaveBeenCalledWith(expect.anything(), CREATED_ID)
  })

  it('rejects reusing the same key with a different payload', async () => {
    const { service, appointment } = createHarness({
      previous: {
        id: CREATED_ID,
        site: 'NEW_TAIPEI_LINKOU',
        machineType: 'MINI_TILLER',
        appointmentDate: new Date('2026-11-05T00:00:00.000Z'),
        period: 'PM',
        hour: 3,
        customerName: '陈先生',
        customerPhone: '0912-345-678',
        contactPerson: '李华',
      },
    })

    await expect(service.create(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      { ...INPUT, customerName: '林小姐' },
      IDEMPOTENCY_KEY,
      NOW,
    )).rejects.toMatchObject({
      code: 'MACHINE_VIEWING_IDEMPOTENCY_CONFLICT',
      status: 409,
    })
    expect(appointment.create).not.toHaveBeenCalled()
  })

  it('maps an impossible calendar day to a 422 before touching the database', async () => {
    const { service, appointment } = createHarness()

    await expect(service.create(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      { ...INPUT, appointmentMonth: 2, appointmentDay: 31 },
      IDEMPOTENCY_KEY,
      NOW,
    )).rejects.toMatchObject({
      code: 'MACHINE_VIEWING_VALIDATION_FAILED',
      status: 422,
    })
    expect(appointment.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a missing or malformed Idempotency-Key', async () => {
    const { service, appointment } = createHarness()

    for (const key of [undefined, '', 'not-a-uuid', 42]) {
      await expect(service.create({ actorUserId: ACTOR, requestId: REQUEST_ID }, INPUT, key, NOW))
        .rejects.toBeInstanceOf(ApiException)
    }
    expect(appointment.findUnique).not.toHaveBeenCalled()
  })

  it('maps a numbering failure to a retryable 409 without writing the appointment', async () => {
    const harness = createHarness()
    harness.numbering.generateScopedInTransaction.mockRejectedValueOnce(
      new NumberingGenerationError('NUMBERING_RULE_UNAVAILABLE'),
    )

    await expect(harness.service.create(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      INPUT,
      IDEMPOTENCY_KEY,
      NOW,
    )).rejects.toMatchObject({
      code: 'MACHINE_VIEWING_NUMBER_UNAVAILABLE',
      status: 409,
    })
    expect(harness.appointment.create).not.toHaveBeenCalled()
  })
})

const UPDATE_INPUT: UpdateMachineViewingDto = {
  site: 'NEW_TAIPEI_LINKOU',
  machineType: 'MINI_TILLER',
  appointmentDate: '2026-11-20',
  period: 'PM',
  hour: 3,
  customerName: '林小姐',
  customerPhone: '0912-345-678',
  contactPerson: '李华',
}

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CREATED_ID,
    appointmentNo: 'MV/20261106-0001',
    site: 'NEW_TAIPEI_LINKOU',
    machineType: 'MINI_TILLER',
    appointmentDate: new Date('2026-11-20T00:00:00.000Z'),
    period: 'PM',
    hour: 3,
    customerName: '陈先生',
    customerPhone: '0912-345-678',
    contactPerson: '李华',
    status: 'PENDING_APPOINTMENT',
    feedback: null,
    ...overrides,
  }
}

describe('MachineViewingService.update', () => {
  it('writes normalized content and a field-level audit entry', async () => {
    const { service, appointment, audit } = createHarness({ existing: existingRow() })

    await expect(service.update({ actorUserId: ACTOR, requestId: REQUEST_ID }, CREATED_ID, UPDATE_INPUT, NOW))
      .resolves.toEqual(dto())

    expect(appointment.update).toHaveBeenCalledWith({
      where: { id: CREATED_ID },
      data: expect.objectContaining({
        customerName: '林小姐',
        appointmentDate: new Date('2026-11-20T00:00:00.000Z'),
      }),
    })
    const auditInput = audit.record.mock.calls[0]?.[1]
    expect(auditInput).toMatchObject({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_UPDATED',
      targetId: CREATED_ID,
      metadata: {
        appointmentNo: 'MV/20261106-0001',
        changedFields: 'customerName',
        status: 'PENDING_APPOINTMENT',
      },
    })
    const metadata = auditInput?.metadata as {
      customerName?: unknown
      previousCustomerName?: unknown
    } | undefined
    expect(metadata?.customerName).toBe('林小姐')
    expect(metadata?.previousCustomerName).toBe('陈先生')
  })

  it('returns the current row without writing when nothing changed', async () => {
    const { service, appointment, audit, queries } = createHarness({ existing: existingRow() })

    await expect(service.update(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { ...UPDATE_INPUT, customerName: '陈先生' },
      NOW,
    )).resolves.toEqual(dto())

    expect(appointment.update).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
    expect(queries.findById).toHaveBeenCalledWith(expect.anything(), CREATED_ID)
  })

  it('locks content edits after feedback or cancellation', async () => {
    for (const status of ['FEEDBACK_GIVEN', 'CANCELLED']) {
      const { service, appointment } = createHarness({ existing: existingRow({ status }) })
      await expect(service.update({ actorUserId: ACTOR, requestId: REQUEST_ID }, CREATED_ID, UPDATE_INPUT, NOW))
        .rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })
      expect(appointment.update).not.toHaveBeenCalled()
    }
  })

  it('returns 404 for a missing or out-of-scope appointment', async () => {
    const { service, appointment } = createHarness({ canViewAll: false })
    await expect(service.update({ actorUserId: ACTOR, requestId: REQUEST_ID }, CREATED_ID, UPDATE_INPUT, NOW))
      .rejects.toMatchObject({ code: 'MACHINE_VIEWING_NOT_FOUND', status: 404 })
    expect(appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdByUserId: ACTOR }),
    }))
    expect(appointment.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid date before opening the transaction', async () => {
    const { service, transaction } = createHarness({ existing: existingRow() })
    await expect(service.update(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { ...UPDATE_INPUT, appointmentDate: '2026-02-31' },
      NOW,
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_VALIDATION_FAILED', status: 422 })
    expect(transaction.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('MachineViewingService.transition', () => {
  it('moves PENDING_APPOINTMENT to APPOINTED and audits the status change', async () => {
    const { service, appointment, audit } = createHarness({ existing: existingRow() })

    await expect(service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'APPOINTED' },
    )).resolves.toEqual(dto())

    expect(appointment.update).toHaveBeenCalledWith({
      where: { id: CREATED_ID },
      data: { status: 'APPOINTED' },
    })
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED',
      metadata: {
        appointmentNo: 'MV/20261106-0001',
        fromStatus: 'PENDING_APPOINTMENT',
        toStatus: 'APPOINTED',
      },
    })
  })

  it('requires feedback before FEEDBACK_GIVEN and does not touch the row', async () => {
    const { service, appointment, transaction } = createHarness({ existing: existingRow({ status: 'APPOINTED' }) })

    await expect(service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'FEEDBACK_GIVEN' },
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_VALIDATION_FAILED', status: 422 })
    expect(transaction.$queryRaw).not.toHaveBeenCalled()
    expect(appointment.update).not.toHaveBeenCalled()
  })

  it('stores feedback while moving APPOINTED to FEEDBACK_GIVEN', async () => {
    const { service, appointment, audit } = createHarness({ existing: existingRow({ status: 'APPOINTED' }) })

    await service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'FEEDBACK_GIVEN', feedback: ' 客户到场，倾向年底下单。 ' },
    )

    expect(appointment.update).toHaveBeenCalledWith({
      where: { id: CREATED_ID },
      data: { status: 'FEEDBACK_GIVEN', feedback: '客户到场，倾向年底下单。' },
    })
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED',
      metadata: { fromStatus: 'APPOINTED', toStatus: 'FEEDBACK_GIVEN', feedback: '客户到场，倾向年底下单。' },
    })
  })

  it('allows editing feedback in place without changing status', async () => {
    const { service, appointment, audit } = createHarness({
      existing: existingRow({ status: 'FEEDBACK_GIVEN', feedback: '旧反馈' }),
    })

    await service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'FEEDBACK_GIVEN', feedback: '新反馈' },
    )

    expect(appointment.update).toHaveBeenCalledWith({
      where: { id: CREATED_ID },
      data: { feedback: '新反馈' },
    })
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_UPDATED',
      metadata: { changedFields: 'feedback', status: 'FEEDBACK_GIVEN', feedback: '新反馈' },
    })
  })

  it('cancels with an audit-only reason and rejects cancelling after feedback', async () => {
    const cancellable = createHarness({ existing: existingRow({ status: 'APPOINTED' }) })
    await cancellable.service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'CANCELLED', cancelReason: '客户临时有事' },
    )
    expect(cancellable.appointment.update).toHaveBeenCalledWith({
      where: { id: CREATED_ID },
      data: { status: 'CANCELLED' },
    })
    expect(cancellable.audit.record.mock.calls[0]?.[1]).toMatchObject({
      metadata: { fromStatus: 'APPOINTED', toStatus: 'CANCELLED', cancelReason: '客户临时有事' },
    })

    const locked = createHarness({ existing: existingRow({ status: 'FEEDBACK_GIVEN', feedback: '已反馈' }) })
    await expect(locked.service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'CANCELLED' },
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })
    expect(locked.appointment.update).not.toHaveBeenCalled()
  })

  it('rejects skipping a step and treats repeated APPOINTED as a no-op', async () => {
    const skipping = createHarness({ existing: existingRow() })
    await expect(skipping.service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'FEEDBACK_GIVEN', feedback: '直接反馈' },
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })

    const repeated = createHarness({ existing: existingRow({ status: 'APPOINTED' }) })
    await repeated.service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'APPOINTED' },
    )
    expect(repeated.appointment.update).not.toHaveBeenCalled()
    expect(repeated.audit.record).not.toHaveBeenCalled()
  })

  it('returns 404 when the row is outside the actor scope', async () => {
    const { service, appointment } = createHarness({ canViewAll: false })
    await expect(service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'APPOINTED' },
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_NOT_FOUND', status: 404 })
    expect(appointment.update).not.toHaveBeenCalled()
  })
})

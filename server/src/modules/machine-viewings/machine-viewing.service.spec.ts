/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest 匹配器返回 any，用于断言调用参数。 */
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
  readonly templates?: readonly Record<string, unknown>[]
  readonly notificationStatus?: string
} = {}) {
  const appointment = {
    findUnique: jest.fn().mockResolvedValue(options.previous ?? null),
    findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn<Promise<{ id: string, scheduleRevision: number }>, [{ data: Record<string, unknown>, select: unknown }]>()
      .mockResolvedValue({ id: CREATED_ID, scheduleRevision: 1 }),
  }
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{}]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    userRole: {
      findFirst: jest.fn().mockResolvedValue(options.canViewAll === true ? { userId: ACTOR } : null),
    },
    notification: {
      findUnique: jest.fn().mockResolvedValue({ status: options.notificationStatus ?? 'COMPLETED' }),
    },
    notificationTemplate: {
      findMany: jest.fn().mockResolvedValue(options.templates ?? []),
    },
    machineViewingAppointment: appointment,
  }
  const notifications = {
    publish: jest.fn().mockResolvedValue({
      notificationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      duplicated: false,
      channels: [{ channel: 'IN_APP', status: 'CREATED', recipientCount: 1, skippedCount: 0 }],
      warnings: [],
    }),
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
    notifications as never,
  )
  return { service, appointment, transaction, queries, audit, numbering, notifications }
}

describe('MachineViewingService.create', () => {
  it('normalizes input, issues a number and writes audit in the same transaction', async () => {
    const { service, appointment, audit, transaction, numbering, notifications } = createHarness()

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
    expect(createArg?.select).toEqual({ id: true, scheduleRevision: true })
    expect(notifications.publish).toHaveBeenCalledTimes(1)
    expect(appointment.update).toHaveBeenCalledWith({
      where: { id: CREATED_ID },
      data: { status: 'APPOINTED' },
    })

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

  it('defers future appointments and today-before-08:30 appointments to the daily batch', async () => {
    const future = createHarness()
    await future.service.create(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      { ...INPUT, appointmentDay: 20 },
      IDEMPOTENCY_KEY,
      NOW,
    )
    expect(future.notifications.publish).not.toHaveBeenCalled()
    expect(future.appointment.update).not.toHaveBeenCalled()

    const before = createHarness()
    await before.service.create(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      INPUT,
      IDEMPOTENCY_KEY,
      new Date('2026-11-05T00:00:00.000Z'),
    )
    expect(before.notifications.publish).not.toHaveBeenCalled()
    expect(before.appointment.update).not.toHaveBeenCalled()
  })

  it('keeps the created appointment PENDING when the immediate notification is not accepted', async () => {
    const harness = createHarness({ notificationStatus: 'SKIPPED' })

    await harness.service.create(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      INPUT,
      IDEMPOTENCY_KEY,
      NOW,
    )

    expect(harness.notifications.publish).toHaveBeenCalledTimes(1)
    expect(harness.appointment.update).not.toHaveBeenCalled()
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
    scheduleRevision: 1,
    ...overrides,
  }
}

describe('MachineViewingService.update', () => {
  it('writes normalized content and a field-level audit entry', async () => {
    const { service, appointment, audit, notifications } = createHarness({ existing: existingRow() })

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
    expect(notifications.publish).not.toHaveBeenCalled()
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

const BEFORE_NOTIFICATION_TIME = new Date('2026-11-05T00:00:00.000Z')

function todayRow(overrides: Record<string, unknown> = {}) {
  return existingRow({ appointmentDate: todayDate(), ...overrides })
}

function todayDate(): Date {
  return new Date('2026-11-05T00:00:00.000Z')
}

function updatePayload(overrides: Partial<UpdateMachineViewingDto> = {}): UpdateMachineViewingDto {
  return {
    ...UPDATE_INPUT,
    appointmentDate: '2026-11-05',
    hour: 4,
    ...overrides,
  }
}

function auditEventTypes(audit: { record: { mock: { calls: unknown[][] } } }): string[] {
  return audit.record.mock.calls.map(call => (call[1] as { eventType: string }).eventType)
}

describe('MachineViewingService schedule changes', () => {
  it('increments the revision for a future PENDING reschedule without notifying', async () => {
    const { service, appointment, audit, notifications } = createHarness({
      existing: existingRow({ appointmentDate: new Date('2026-11-10T00:00:00.000Z') }),
    })

    await service.update(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { ...UPDATE_INPUT, appointmentDate: '2026-11-20' },
      NOW,
    )

    expect(notifications.publish).not.toHaveBeenCalled()
    expect(appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scheduleRevision: 2 }),
    }))
    expect(auditEventTypes(audit)).toContain('MACHINE_VIEWING_APPOINTMENT_RESCHEDULED')
  })

  it('sends a reschedule event and returns an APPOINTED future appointment to PENDING', async () => {
    const { service, appointment, audit, notifications } = createHarness({
      existing: existingRow({
        appointmentDate: new Date('2026-11-10T00:00:00.000Z'),
        status: 'APPOINTED',
      }),
    })

    await service.update(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { ...UPDATE_INPUT, appointmentDate: '2026-11-20' },
      NOW,
    )

    expect(notifications.publish).toHaveBeenCalledTimes(1)
    expect(notifications.publish.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_RESCHEDULED',
    })
    expect(appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scheduleRevision: 2,
        status: 'PENDING_APPOINTMENT',
      }),
    }))
    expect(auditEventTypes(audit)).toContain('MACHINE_VIEWING_APPOINTMENT_RESCHEDULED')
  })

  it('immediately notifies a PENDING same-day reschedule after 08:30 and advances it', async () => {
    const { service, appointment, notifications } = createHarness({ existing: todayRow({ hour: 2 }) })

    await service.update(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      updatePayload({ hour: 4 }),
      NOW,
    )

    expect(notifications.publish).toHaveBeenCalledTimes(1)
    expect(notifications.publish.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_CREATED',
    })
    expect(appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scheduleRevision: 2, status: 'APPOINTED' }),
    }))
  })

  it('sends reschedule then appointment notification for an APPOINTED same-day change after 08:30', async () => {
    const { service, appointment, notifications } = createHarness({
      existing: todayRow({ hour: 2, status: 'APPOINTED' }),
    })

    await service.update(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      updatePayload({ hour: 4 }),
      NOW,
    )

    expect(notifications.publish.mock.calls.map(call => (call[0] as { eventType: string }).eventType))
      .toEqual(['MACHINE_VIEWING_APPOINTMENT_RESCHEDULED', 'MACHINE_VIEWING_APPOINTMENT_CREATED'])
    // 原状态和最终状态都是 APPOINTED，事务内不需要再写一次 status。
    expect(appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scheduleRevision: 2 }),
    }))
  })

  it('keeps a same-day PENDING reschedule PENDING before 08:30 and leaves it for the batch', async () => {
    const { service, appointment, notifications } = createHarness({ existing: todayRow({ hour: 2 }) })

    await service.update(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      updatePayload({ hour: 4 }),
      BEFORE_NOTIFICATION_TIME,
    )

    expect(notifications.publish).not.toHaveBeenCalled()
    expect(appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scheduleRevision: 2 }),
    }))
  })

  it('sends only the reschedule event for an APPOINTED same-day change before 08:30', async () => {
    const { service, appointment, notifications } = createHarness({
      existing: todayRow({ hour: 2, status: 'APPOINTED' }),
    })

    await service.update(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      updatePayload({ hour: 4 }),
      BEFORE_NOTIFICATION_TIME,
    )

    expect(notifications.publish).toHaveBeenCalledTimes(1)
    expect(notifications.publish.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_RESCHEDULED',
    })
    expect(appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scheduleRevision: 2,
        status: 'PENDING_APPOINTMENT',
      }),
    }))
  })
})

describe('MachineViewingService manual notification', () => {
  it('renders the same appointment text without publishing a notification', async () => {
    const { service, notifications } = createHarness({
      existing: todayRow(),
      templates: [{
        bodyTemplate: '看机预约 {{appointmentNo}}',
        channel: 'ASSISTANT',
        linkUrlTemplate: null,
        maxLength: 2000,
        titleTemplate: null,
        variables: [{ name: 'appointmentNo', required: false, maxLength: 200, sensitive: false }],
      }],
    })

    await expect(service.manualNotificationText(ACTOR, CREATED_ID, NOW)).resolves.toEqual({
      body: '看机预约 MV/20261106-0001',
      title: null,
    })
    expect(notifications.publish).not.toHaveBeenCalled()
  })

  it('rejects manual text for a future or non-pending appointment', async () => {
    const future = createHarness({ existing: existingRow() })
    await expect(future.service.manualNotificationText(ACTOR, CREATED_ID, NOW))
      .rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })

    const appointed = createHarness({ existing: todayRow({ status: 'APPOINTED' }) })
    await expect(appointed.service.manualNotificationText(ACTOR, CREATED_ID, NOW))
      .rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })
  })

  it('marks a today PENDING appointment manually and audits the copy trigger', async () => {
    const { service, appointment, audit } = createHarness({ existing: todayRow() })

    await expect(service.markManuallyNotified(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      NOW,
    )).resolves.toEqual(dto())

    expect(appointment.update).toHaveBeenCalledWith({
      where: { id: CREATED_ID },
      data: { status: 'APPOINTED' },
    })
    expect(auditEventTypes(audit)).toContain('MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED')
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      metadata: { trigger: 'MANUAL_COPY' },
    })
  })

  it('rejects manual marking for a future appointment', async () => {
    const { service, appointment } = createHarness({ existing: existingRow() })
    await expect(service.markManuallyNotified(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      NOW,
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })
    expect(appointment.update).not.toHaveBeenCalled()
  })
})

describe('MachineViewingService.transition', () => {
  it('moves PENDING_APPOINTMENT to APPOINTED and audits the status change', async () => {
    const { service, appointment, audit } = createHarness({
      existing: existingRow({ appointmentDate: new Date('2026-11-05T00:00:00.000Z') }),
    })

    await expect(service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'APPOINTED' },
      NOW,
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

  it('rejects manually advancing a future appointment to APPOINTED', async () => {
    const { service, appointment } = createHarness({ existing: existingRow() })
    await expect(service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'APPOINTED' },
      NOW,
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })
    expect(appointment.update).not.toHaveBeenCalled()
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

    const repeated = createHarness({
      existing: existingRow({
        appointmentDate: new Date('2026-11-05T00:00:00.000Z'),
        status: 'APPOINTED',
      }),
    })
    await repeated.service.transition(
      { actorUserId: ACTOR, requestId: REQUEST_ID },
      CREATED_ID,
      { status: 'APPOINTED' },
      NOW,
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

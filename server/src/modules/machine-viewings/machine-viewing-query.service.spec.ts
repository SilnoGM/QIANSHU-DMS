import { ApiException } from '../../infrastructure/http/api.exception'
import { buildMachineViewingListWhere, MachineViewingQueryService } from './machine-viewing-query.service'

const ACTOR = 'c1a2b3c4-d5e6-47f8-9a0b-c1d2e3f4a5b6'

describe('buildMachineViewingListWhere', () => {
  it('keeps the row-level scope and combines every filter with AND semantics', () => {
    const where = buildMachineViewingListWhere(
      { actorUserId: ACTOR, canViewAll: false },
      {
        keyword: '  陈先生 ',
        status: 'PENDING_APPOINTMENT',
        site: 'NEW_TAIPEI_LINKOU',
        machineType: 'MINI_TILLER',
        dateFrom: '2026-11-01',
        dateTo: '2026-11-30',
      },
    )

    expect(where).toMatchObject({
      createdByUserId: ACTOR,
      status: 'PENDING_APPOINTMENT',
      site: 'NEW_TAIPEI_LINKOU',
      machineType: 'MINI_TILLER',
      appointmentDate: {
        gte: new Date('2026-11-01T00:00:00.000Z'),
        lte: new Date('2026-11-30T00:00:00.000Z'),
      },
    })
    expect(where.OR).toEqual([
      { appointmentNo: { contains: '陈先生', mode: 'insensitive' } },
      { customerName: { contains: '陈先生', mode: 'insensitive' } },
      { customerPhone: { contains: '陈先生', mode: 'insensitive' } },
      { contactPerson: { contains: '陈先生', mode: 'insensitive' } },
    ])
  })

  it('does not add a scope filter for data-scope:all viewers', () => {
    const where = buildMachineViewingListWhere(
      { actorUserId: ACTOR, canViewAll: true },
      { page: 1, pageSize: 20 },
    )
    expect(where).toEqual({})
  })

  it('ignores a blank keyword and supports one-sided date ranges', () => {
    expect(buildMachineViewingListWhere(
      { actorUserId: ACTOR, canViewAll: true },
      { keyword: '   ', dateFrom: '2026-11-01' },
    )).toEqual({ appointmentDate: { gte: new Date('2026-11-01T00:00:00.000Z') } })
  })

  it('rejects impossible dates and reversed ranges as 422 before querying', () => {
    for (const query of [
      { dateFrom: '2026-02-31' },
      { dateTo: '2026-13-01' },
      { dateFrom: '2026-11-30', dateTo: '2026-11-01' },
    ]) {
      expect(() => buildMachineViewingListWhere({ actorUserId: ACTOR, canViewAll: true }, query))
        .toThrow(ApiException)
    }
  })
})

describe('MachineViewingQueryService.statusCounts', () => {
  it('returns ALL plus every status count with the same non-status filters', async () => {
    const count = jest.fn(({ where }: { where: { status?: string } }) =>
      Promise.resolve(where.status === undefined
        ? 7
        : where.status === 'PENDING_APPOINTMENT' ? 3 : 1))
    const transaction = {
      machineViewingAppointment: { count },
      userRole: { findFirst: jest.fn().mockResolvedValue({ userId: ACTOR }) },
    }
    const service = new MachineViewingQueryService({
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(transaction)),
    } as never)

    await expect(service.statusCounts(ACTOR, {
      keyword: '陈先生',
      site: 'NEW_TAIPEI_LINKOU',
      dateFrom: '2026-11-01',
    })).resolves.toEqual({
      statuses: [
        { value: 'ALL', count: 7 },
        { value: 'PENDING_APPOINTMENT', count: 3 },
        { value: 'APPOINTED', count: 1 },
        { value: 'FEEDBACK_GIVEN', count: 1 },
        { value: 'CANCELLED', count: 1 },
      ],
    })
    expect(count).toHaveBeenCalledTimes(5)
    for (const call of count.mock.calls) {
      expect(call[0].where).toMatchObject({
        site: 'NEW_TAIPEI_LINKOU',
        appointmentDate: { gte: new Date('2026-11-01T00:00:00.000Z') },
      })
    }
  })
})

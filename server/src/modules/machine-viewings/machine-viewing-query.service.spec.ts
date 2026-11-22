import { ApiException } from '../../infrastructure/http/api.exception'
import { buildMachineViewingListWhere } from './machine-viewing-query.service'

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

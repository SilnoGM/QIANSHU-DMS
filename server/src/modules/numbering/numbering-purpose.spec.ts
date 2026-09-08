import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import type { Prisma } from '../../generated/prisma/client'
import {
  CloneNumberingRuleRequestDto,
  CreateNumberingRuleRequestDto,
  UpdateNumberingRuleRequestDto,
} from './dto/numbering-command.dto'
import { NumberingRuleListQueryDto } from './dto/numbering-management.dto'
import { normalizeNumberingRuleListQuery } from './numbering-query.normalizer'
import { readNumberingRuleListPageInTransaction } from './numbering-query.persistence'

const createInput = {
  ruleCode: 'MARK', name: '唛头规则', resetPolicy: 'NEVER',
  segments: [{ type: 'SEQUENCE', width: 4, startValue: '1', step: '1' }],
}
async function errorsFor<T extends object>(dto: new () => T, input: object) {
  return validate(plainToInstance(dto, input), { whitelist: true, forbidNonWhitelisted: true })
}

describe('numbering purpose boundary', () => {
  it.each(['BUSINESS', 'SHIPPING_MARK'])('accepts explicit %s on creation only', async (purpose) => {
    expect(await errorsFor(CreateNumberingRuleRequestDto, { ...createInput, purpose })).toEqual([])
    for (const dto of [UpdateNumberingRuleRequestDto, CloneNumberingRuleRequestDto]) {
      const errors = await errorsFor(dto, { expectedVersion: 1, ruleCode: 'COPY', name: '复制', purpose })
      expect(errors.map(error => error.property)).toContain('purpose')
    }
  })

  it.each([undefined, null, 'ALL', '', 'OTHER'])('rejects missing or invalid purpose %s', async (purpose) => {
    const errors = await errorsFor(CreateNumberingRuleRequestDto, { ...createInput, purpose })
    expect(errors.map(error => error.property)).toContain('purpose')
  })

  it('validates optional list purpose and preserves it during normalization', async () => {
    expect(await errorsFor(NumberingRuleListQueryDto, { purpose: 'SHIPPING_MARK' })).toEqual([])
    expect(normalizeNumberingRuleListQuery(plainToInstance(NumberingRuleListQueryDto, { purpose: 'SHIPPING_MARK' })))
      .toMatchObject({ purpose: 'SHIPPING_MARK' })
    for (const purpose of ['ALL', null, ['BUSINESS']]) {
      expect((await errorsFor(NumberingRuleListQueryDto, { purpose })).map(error => error.property)).toContain('purpose')
      expect(() => normalizeNumberingRuleListQuery(plainToInstance(NumberingRuleListQueryDto, { purpose }))).toThrow()
    }
  })

  it('aggregates across purpose and pagination while filtering rows by the selected purpose', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ purpose: 'BUSINESS', _count: { _all: 4 } }])
    const count = jest.fn().mockResolvedValue(0)
    const findMany = jest.fn().mockResolvedValue([])
    const transaction = { numberingRule: { groupBy, count, findMany } } as unknown as Prisma.TransactionClient
    const query = normalizeNumberingRuleListQuery(plainToInstance(NumberingRuleListQueryDto, {
      purpose: 'SHIPPING_MARK', keyword: '合同', status: 'DRAFT', page: 3, pageSize: 1,
    }))
    const result = await readNumberingRuleListPageInTransaction(transaction, query)
    expect(result).toMatchObject({
      total: 0, rows: [], purposeCounts: [
        { value: 'ALL', count: 4 }, { value: 'BUSINESS', count: 4 }, { value: 'SHIPPING_MARK', count: 0 },
      ],
    })
    expect(groupBy).toHaveBeenCalledTimes(1)
    expect(groupBy).toHaveBeenCalledWith({
      by: ['purpose'], _count: { _all: true },
      where: { status: 'DRAFT', OR: [
        { ruleCode: { contains: '合同', mode: 'insensitive' } },
        { name: { contains: '合同', mode: 'insensitive' } },
        { description: { contains: '合同', mode: 'insensitive' } },
      ] },
    })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ purpose: 'SHIPPING_MARK' }) as unknown, skip: 2, take: 1,
    }))
  })
})

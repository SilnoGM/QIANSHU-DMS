import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import {
  CreateFundManualAdjustmentRequestDto,
  CreateFundAccountRequestDto,
  UpdateFundShareRateRequestDto,
} from './fund-account.dto'
import {
  FundBusinessSourceListQueryDto,
  FundPostingTypeListQueryDto,
} from './fund-configuration.dto'
import { CreateFundReversalRequestDto } from './fund-transaction.dto'

describe('Fund account DTOs', () => {
  it.each([
    ['0', true],
    ['30.12', true],
    ['99.99', true],
    ['100', true],
    ['100.00', true],
    ['30.001', false],
    ['-1', false],
    ['100.01', false],
    ['101', false],
    ['999', false],
  ])('validates user share rate %s', async (userShareRate, valid) => {
    const create = plainToInstance(CreateFundAccountRequestDto, {
      userId: '77777777-7777-4777-8777-777777777777',
      userShareRate,
    })
    const update = plainToInstance(UpdateFundShareRateRequestDto, {
      userShareRate,
      expectedVersion: 1,
      reason: '测试分成比例边界',
    })

    const [createErrors, updateErrors] = await Promise.all([
      validate(create),
      validate(update),
    ])
    expect(createErrors).toHaveLength(valid ? 0 : 1)
    expect(updateErrors).toHaveLength(valid ? 0 : 1)
  })

  it.each([FundPostingTypeListQueryDto, FundBusinessSourceListQueryDto])(
    '%p preserves false boolean query values',
    async dtoType => {
      const disabled = plainToInstance(dtoType, { enabled: 'false' })
      const enabled = plainToInstance(dtoType, { enabled: 'true' })
      const invalid = plainToInstance(dtoType, { enabled: 'yes' })

      expect(disabled.enabled).toBe(false)
      expect(enabled.enabled).toBe(true)
      await expect(validate(disabled)).resolves.toEqual([])
      await expect(validate(enabled)).resolves.toEqual([])
      await expect(validate(invalid)).resolves.not.toEqual([])
    },
  )

  it.each([
    ['100', true],
    ['0.01', true],
    ['0.001', false],
    ['0', false],
    ['0.00', false],
    ['-0.01', false],
    ['-100', false],
  ])('requires a positive reversal amount %s', async (amount, valid) => {
    const dto = plainToInstance(CreateFundReversalRequestDto, {
      amount,
      reason: '测试冲账金额边界',
    })

    expect(await validate(dto)).toHaveLength(valid ? 0 : 1)
  })

  it.each([
    ['100', true],
    ['-100', true],
    ['0.01', true],
    ['-0.01', true],
    ['0.001', false],
    ['0', false],
    ['-0.00', false],
  ])('requires a signed non-zero adjustment amount %s', async (amount, valid) => {
    const dto = plainToInstance(CreateFundManualAdjustmentRequestDto, {
      amount,
      adjustmentMode: 'USER_ONLY',
      reason: '测试调账金额边界',
    })

    expect(await validate(dto)).toHaveLength(valid ? 0 : 1)
  })
})

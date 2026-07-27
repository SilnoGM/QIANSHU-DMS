import { ApiException } from '../../infrastructure/http/api.exception'
import { mapRegionPersistenceError } from './region.persistence-error.mapper'

function expectMapped(
  error: unknown,
  expected: {
    code: string
    message: string
    status: number
  },
): void {
  const mapped = mapRegionPersistenceError(error)

  expect(mapped).toBeInstanceOf(ApiException)
  expect(mapped.getStatus()).toBe(expected.status)
  expect(mapped.code).toBe(expected.code)
  expect(mapped.publicMessage).toBe(expected.message)
  expect(mapped.message).not.toContain('must-not-leak')
  expect(JSON.stringify(mapped)).not.toContain('must-not-leak')
}

describe('Region persistence error mapper', () => {
  it('distinguishes code, sibling and root unique conflicts', () => {
    expectMapped(
      {
        code: 'P2002',
        message: 'must-not-leak code value',
        meta: { target: ['code'] },
      },
      {
        code: 'REGION_CODE_ALREADY_EXISTS',
        message: '地区编码已存在',
        status: 409,
      },
    )
    expectMapped(
      {
        code: 'P2002',
        message: 'must-not-leak sibling name',
        meta: { target: ['parent_id', 'normalized_name'] },
      },
      {
        code: 'REGION_NAME_ALREADY_EXISTS',
        message: '同一上级下地区名称已存在',
        status: 409,
      },
    )
    expectMapped(
      {
        code: '23505',
        constraint: 'regions_root_normalized_name_key',
        detail: 'must-not-leak root name',
      },
      {
        code: 'REGION_NAME_ALREADY_EXISTS',
        message: '同一上级下地区名称已存在',
        status: 409,
      },
    )
  })

  it('maps only the known parent foreign key and hierarchy check', () => {
    expectMapped(
      {
        code: 'P2003',
        message: 'must-not-leak parent id',
        meta: { field_name: 'regions_parent_id_fkey (index)' },
      },
      {
        code: 'REGION_PARENT_NOT_FOUND',
        message: '上级地区不存在',
        status: 404,
      },
    )
    expectMapped(
      {
        code: 'P2010',
        meta: {
          database_error: {
            code: '23514',
            constraint: 'regions_hierarchy_check',
            message: 'must-not-leak SQL',
          },
        },
      },
      {
        code: 'REGION_HIERARCHY_INVALID',
        message: '地区层级关系不合法',
        status: 422,
      },
    )
  })

  it.each([
    { code: 'P2034', message: 'must-not-leak serialization' },
    { code: '40001', message: 'must-not-leak transaction' },
    {
      code: 'P2010',
      meta: { database_error: { code: '40P01' } },
      message: 'must-not-leak deadlock',
    },
    {
      code: 'P2010',
      meta: { driver_adapter_error: { cause: { code: '55P03' } } },
      message: 'must-not-leak lock',
    },
  ])('maps retryable transaction state %#', (error) => {
    expectMapped(error, {
      code: 'REGION_STATE_CHANGED',
      message: '地区状态已变化，请刷新后重试',
      status: 409,
    })
  })

  it('preserves an already-safe ApiException', () => {
    const original = new ApiException(
      404,
      'REGION_NOT_FOUND',
      '地区不存在',
    )

    expect(mapRegionPersistenceError(original)).toBe(original)
  })

  it('maps unknown or partially matching errors to one fixed safe 500', () => {
    for (const error of [
      new Error('must-not-leak password=secret'),
      { code: 'P2002', meta: { target: ['unknown'] }, message: 'must-not-leak' },
      { code: 'P2002', meta: { target: ['zipcode'] }, message: 'must-not-leak' },
      {
        code: 'P2002',
        meta: { target: ['normalized_name'] },
        message: 'must-not-leak',
      },
      {
        code: 'P2002',
        meta: { target: ['parent_id', 'normalized_name_shadow'] },
        message: 'must-not-leak',
      },
      {
        code: '23514',
        constraint: 'regions_sort_order_nonnegative_check',
        message: 'must-not-leak',
      },
      {
        code: '23503',
        constraint: 'other_foreign_key',
        message: 'must-not-leak',
      },
    ]) {
      expectMapped(error, {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        status: 500,
      })
    }
  })
})

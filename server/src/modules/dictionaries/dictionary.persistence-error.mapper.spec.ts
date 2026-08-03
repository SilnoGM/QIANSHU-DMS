import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import { DICTIONARY_ERROR_CODES } from './dictionary.errors'
import {
  type DictionaryPersistenceErrorContext,
  mapDictionaryPersistenceError,
} from './dictionary.persistence-error.mapper'

function expectMapped(
  error: unknown,
  context: DictionaryPersistenceErrorContext,
  expected: {
    readonly status: HttpStatus
    readonly code: string
    readonly publicMessage: string
  },
): void {
  const mapped = mapDictionaryPersistenceError(error, context)
  const serializedResponse = JSON.stringify(mapped.getResponse())

  expect(mapped).toBeInstanceOf(ApiException)
  expect(mapped.getStatus()).toBe(expected.status)
  expect(mapped.code).toBe(expected.code)
  expect(mapped.publicMessage).toBe(expected.publicMessage)
  expect(mapped.message).toBe(expected.publicMessage)
  expect(serializedResponse).not.toContain('must-not-leak')
  expect(serializedResponse).not.toContain('postgresql://')
  expect(serializedResponse).not.toContain('SELECT')
}

function expectInternal(
  error: unknown,
  context: DictionaryPersistenceErrorContext,
): void {
  expectMapped(error, context, {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: DICTIONARY_ERROR_CODES.INTERNAL_ERROR,
    publicMessage: '服务器内部错误',
  })
}

describe('Dictionary persistence error mapper', () => {
  it('maps structured Type code unique violations', () => {
    for (const error of [
      {
        code: 'P2002',
        meta: { target: ['code'] },
        message: 'must-not-leak TYPE_CODE',
      },
      {
        code: '23505',
        constraint: 'dictionary_types_code_key',
        detail: 'must-not-leak TYPE_CODE',
      },
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: { constraint: { fields: ['code'] } },
          },
        },
      },
    ]) {
      expectMapped(error, 'TYPE', {
        status: HttpStatus.CONFLICT,
        code: DICTIONARY_ERROR_CODES.TYPE_CODE_ALREADY_EXISTS,
        publicMessage: '字典类型编码已存在',
      })
    }

    expectInternal(
      { code: 'P2002', meta: { target: ['code', 'other'] } },
      'TYPE',
    )
    expectInternal(
      { code: 'P2002', meta: { target: ['code'] } },
      'ITEM',
    )
  })

  it('maps only the exact Item composite target or named constraint', () => {
    for (const error of [
      {
        code: 'P2002',
        meta: { target: ['dictionaryTypeId', 'value'] },
        message: 'must-not-leak ITEM_VALUE',
      },
      {
        code: 'P2002',
        meta: { target: ['dictionary_type_id', 'value'] },
      },
      {
        code: '23505',
        constraint: 'dictionary_items_dictionary_type_id_value_key',
      },
    ]) {
      expectMapped(error, 'ITEM', {
        status: HttpStatus.CONFLICT,
        code: DICTIONARY_ERROR_CODES.ITEM_VALUE_ALREADY_EXISTS,
        publicMessage: '字典条目值已存在',
      })
    }

    for (const target of [
      ['value'],
      ['dictionaryTypeId'],
      ['dictionaryTypeId', 'value', 'enabled'],
    ]) {
      expectInternal({ code: 'P2002', meta: { target } }, 'ITEM')
    }

    expectInternal(
      {
        code: '23505',
        constraint: 'dictionary_items_dictionary_type_id_value_key',
      },
      'TYPE',
    )
  })

  it('maps the two enabled-item CHECK constraints without reading messages', () => {
    for (const [context, constraint] of [
      ['TYPE', 'dictionary_types_enabled_item_required_check'],
      ['ITEM', 'dictionary_items_last_enabled_check'],
    ] as const) {
      expectMapped(
        {
          code: 'P2010',
          meta: {
            database_error: {
              code: '23514',
              constraint,
              message: 'must-not-leak SELECT and input',
            },
          },
        },
        context,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: DICTIONARY_ERROR_CODES.TYPE_ENABLED_ITEM_REQUIRED,
          publicMessage: '启用的字典类型必须至少保留一个启用条目',
        },
      )
    }
  })

  it.each([
    ['P2034', 'TYPE', DICTIONARY_ERROR_CODES.TYPE_STATE_CHANGED],
    ['P2034', 'ITEM', DICTIONARY_ERROR_CODES.ITEM_STATE_CHANGED],
    ['40001', 'TYPE', DICTIONARY_ERROR_CODES.TYPE_STATE_CHANGED],
    ['40001', 'ITEM', DICTIONARY_ERROR_CODES.ITEM_STATE_CHANGED],
    ['40P01', 'TYPE', DICTIONARY_ERROR_CODES.TYPE_STATE_CHANGED],
    ['40P01', 'ITEM', DICTIONARY_ERROR_CODES.ITEM_STATE_CHANGED],
    ['55P03', 'TYPE', DICTIONARY_ERROR_CODES.TYPE_STATE_CHANGED],
    ['55P03', 'ITEM', DICTIONARY_ERROR_CODES.ITEM_STATE_CHANGED],
  ] as const)(
    'maps transaction conflict %s using %s context',
    (code, context, expectedCode) => {
      expectMapped(
        {
          code: 'P2010',
          meta: {
            driver_adapter_error: {
              cause: { code, message: 'must-not-leak postgresql://secret' },
            },
          },
        },
        context,
        {
          status: HttpStatus.CONFLICT,
          code: expectedCode,
          publicMessage:
            context === 'TYPE'
              ? '字典类型状态已变化，请刷新后重试'
              : '字典条目状态已变化，请刷新后重试',
        },
      )
    },
  )

  it('preserves an existing safe ApiException by identity', () => {
    const existing = new ApiException(
      HttpStatus.NOT_FOUND,
      DICTIONARY_ERROR_CODES.ITEM_NOT_FOUND,
      '字典条目不存在',
    )

    expect(mapDictionaryPersistenceError(existing, 'ITEM')).toBe(existing)
  })

  it('fails closed for delete and identity CHECK constraints', () => {
    for (const constraint of [
      'dictionary_types_delete_check',
      'dictionary_types_identity_immutable_check',
      'dictionary_items_delete_check',
      'dictionary_items_identity_immutable_check',
    ]) {
      expectInternal(
        {
          code: '23514',
          constraint,
          message: 'must-not-leak SELECT secret',
        },
        constraint.startsWith('dictionary_types_') ? 'TYPE' : 'ITEM',
      )
    }
  })

  it('fails closed for unknown, malformed and message-only errors', () => {
    for (const error of [
      new Error(
        'duplicate key dictionary_types_code_key must-not-leak TYPE_CODE',
      ),
      {
        code: 'P2002',
        message: 'dictionary_types_code_key must-not-leak TYPE_CODE',
      },
      {
        code: 23505,
        constraint: ['dictionary_types_code_key'],
        message: 'must-not-leak malformed facts',
      },
      {
        code: '23505',
        constraint: 'unrelated_unique_key',
        message: 'must-not-leak unknown constraint',
      },
      null,
    ]) {
      expectInternal(error, 'TYPE')
    }
  })
})

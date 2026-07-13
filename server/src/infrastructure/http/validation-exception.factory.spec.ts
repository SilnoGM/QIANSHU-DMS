import type { ValidationError } from 'class-validator'

import { ApiException } from './api.exception'
import {
  createValidationException,
  flattenValidationErrors,
} from './validation-exception.factory'

function validationError(
  property: string,
  options: {
    constraints?: Record<string, string>
    children?: ValidationError[]
  },
): ValidationError {
  return {
    property,
    constraints: options.constraints,
    children: options.children,
  }
}

describe('flattenValidationErrors', () => {
  it('flattens nested array paths and translates default validator messages', () => {
    const errors = [
      validationError('items', {
        children: [
          validationError('0', {
            children: [
              validationError('name', {
                constraints: { isString: 'name must be a string' },
              }),
            ],
          }),
        ],
      }),
      validationError('unknown', {
        constraints: {
          whitelistValidation: 'property unknown should not exist',
        },
      }),
    ]

    expect(flattenValidationErrors(errors)).toEqual({
      'items.0.name': ['必须是字符串'],
      unknown: ['不允许提交该字段'],
    })
  })

  it.each([
    [
      'whitelistValidation',
      'property 敏感字段 should not exist',
      '不允许提交该字段',
    ],
    ['isString', '敏感字段 must be a string', '必须是字符串'],
  ] as const)(
    'maps the %s default English template when the property name is Chinese',
    (constraintName, defaultMessage, expectedMessage) => {
      const errors = [
        validationError('敏感字段', {
          constraints: { [constraintName]: defaultMessage },
        }),
      ]

      expect(flattenValidationErrors(errors)).toEqual({
        敏感字段: [expectedMessage],
      })
    },
  )

  it('preserves explicit Chinese messages and removes duplicate messages', () => {
    const errors = [
      validationError('displayName', {
        constraints: {
          isString: '显示名称必须是文本',
          customDisplayName: '显示名称必须是文本',
        },
      }),
    ]

    expect(flattenValidationErrors(errors)).toEqual({
      displayName: ['显示名称必须是文本'],
    })
  })

  it('preserves an explicit Chinese message containing its ASCII property', () => {
    const errors = [
      validationError('displayName', {
        constraints: {
          customDisplayName: 'displayName必须是文本',
        },
      }),
    ]

    expect(flattenValidationErrors(errors)).toEqual({
      displayName: ['displayName必须是文本'],
    })
  })

  it('hides unknown English details containing a Chinese property interpolation', () => {
    const errors = [
      validationError('敏感字段', {
        constraints: {
          unknownConstraint: '敏感字段 sensitive validator implementation detail',
        },
      }),
    ]

    expect(flattenValidationErrors(errors)).toEqual({
      敏感字段: ['字段校验失败'],
    })
  })

  it('maps known constraints and hides every unknown English message', () => {
    const errors = [
      validationError('name', {
        constraints: {
          isNotEmpty: 'name should not be empty',
          isString: 'name must be a string',
          unknownConstraint: 'sensitive validator implementation detail',
        },
      }),
    ]

    expect(flattenValidationErrors(errors)).toEqual({
      name: ['不能为空', '必须是字符串', '字段校验失败'],
    })
    expect(JSON.stringify(flattenValidationErrors(errors))).not.toContain(
      'sensitive validator implementation detail',
    )
  })

  it('keeps __proto__ as an own field error without changing object prototypes', () => {
    const errors = [
      validationError('__proto__', {
        constraints: { isString: '__proto__ must be a string' },
      }),
    ]

    const fieldErrors = flattenValidationErrors(errors)

    expect(Object.prototype.hasOwnProperty.call(fieldErrors, '__proto__')).toBe(
      true,
    )
    expect(fieldErrors['__proto__']).toEqual(['必须是字符串'])
    expect(Object.getPrototypeOf(fieldErrors)).toBe(Object.prototype)
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })
})

describe('createValidationException', () => {
  it('creates the fixed 422 validation contract with flattened field errors', () => {
    const errors = [
      validationError('name', {
        constraints: { isNotEmpty: 'name should not be empty' },
      }),
    ]

    const exception = createValidationException(errors)

    expect(exception).toBeInstanceOf(ApiException)
    expect(exception.getStatus()).toBe(422)
    expect(exception.code).toBe('VALIDATION_FAILED')
    expect(exception.publicMessage).toBe('请求参数校验失败')
    expect(exception.fieldErrors).toEqual({ name: ['不能为空'] })
  })
})

import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import {
  isRetryableNumberingErrorCode,
  NUMBERING_ERROR_CODES,
} from './numbering.errors'
import { mapNumberingPersistenceError } from './numbering.persistence-error.mapper'

function expectMapped(
  error: unknown,
  status: HttpStatus,
  code: string,
): void {
  const mapped = mapNumberingPersistenceError(error)

  expect(mapped).toBeInstanceOf(ApiException)
  expect(mapped.getStatus()).toBe(status)
  expect(mapped.code).toBe(code)
  expect(mapped.publicMessage).not.toContain('secret')
}

describe('numbering persistence error mapper', () => {
  it('publishes exactly the frozen nine numbering error codes', () => {
    expect(Object.values(NUMBERING_ERROR_CODES).sort()).toEqual([
      'NUMBERING_CAPACITY_EXHAUSTED',
      'NUMBERING_GENERATION_RETRY_EXHAUSTED',
      'NUMBERING_IDEMPOTENCY_CONFLICT',
      'NUMBERING_OUTPUT_CONFLICT',
      'NUMBERING_RULE_CODE_ALREADY_EXISTS',
      'NUMBERING_RULE_CONFIG_INVALID',
      'NUMBERING_RULE_NOT_FOUND',
      'NUMBERING_RULE_STATE_CHANGED',
      'NUMBERING_RULE_UNAVAILABLE',
    ])
  })

  it('maps structured unique violations to their stable conflicts', () => {
    expectMapped(
      {
        code: 'P2002',
        meta: { target: ['rule_code'] },
        message: 'secret rule code',
      },
      HttpStatus.CONFLICT,
      'NUMBERING_RULE_CODE_ALREADY_EXISTS',
    )
    expectMapped(
      {
        code: '23505',
        constraint: 'numbering_issuances_rule_id_generated_number_key',
      },
      HttpStatus.CONFLICT,
      'NUMBERING_OUTPUT_CONFLICT',
    )
  })

  it('leaves idempotency unique races to the Task 9 replay orchestrator', () => {
    expectMapped(
      {
        code: '23505',
        constraint:
          'numbering_issuances_consumer_code_idempotency_key_hash_key',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })

  it.each(['P2034', '40001', '40P01', '55P03', '57014'])(
    'maps transient structured code %s to retryable state change',
    code => {
      expectMapped(
        { code, message: 'secret database detail' },
        HttpStatus.CONFLICT,
        'NUMBERING_RULE_STATE_CHANGED',
      )
    },
  )

  it('maps named configuration CHECK constraints without reading messages', () => {
    for (const constraint of [
      'numbering_rules_rule_code_format_check',
      'numbering_rule_versions_timezone_check',
      'numbering_rule_segments_shape_check',
      'numbering_rule_segments_sequence_range_check',
      'numbering_rule_segments_random_length_check',
    ]) {
      expectMapped(
        {
          code: '23514',
          constraint,
          message: 'secret SQL and user value',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
        'NUMBERING_RULE_CONFIG_INVALID',
      )
    }
  })

  it('maps named immutable and transition constraints to state change', () => {
    for (const constraint of [
      'numbering_rule_versions_config_immutable_check',
      'numbering_rule_versions_status_transition_check',
      'numbering_rule_segments_parent_draft_check',
    ]) {
      expectMapped(
        { code: '23514', constraint },
        HttpStatus.CONFLICT,
        'NUMBERING_RULE_STATE_CHANGED',
      )
    }
  })

  it('passes through public exceptions and safely closes unknown errors', () => {
    const existing = new ApiException(
      HttpStatus.NOT_FOUND,
      'NUMBERING_RULE_NOT_FOUND',
      '编号规则不存在',
    )

    expect(mapNumberingPersistenceError(existing)).toBe(existing)
    expectMapped(
      new Error('secret SQL and key'),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
    expectMapped(
      { code: 'P2002', message: 'secret unknown unique' },
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })

  it('marks only the two frozen public codes as retryable', () => {
    for (const code of Object.values(NUMBERING_ERROR_CODES)) {
      expect(isRetryableNumberingErrorCode(code)).toBe(
        code === 'NUMBERING_GENERATION_RETRY_EXHAUSTED'
        || code === 'NUMBERING_RULE_STATE_CHANGED',
      )
    }
    expect(isRetryableNumberingErrorCode('INTERNAL_ERROR')).toBe(false)
    expect(isRetryableNumberingErrorCode('VALIDATION_FAILED')).toBe(false)
  })
})

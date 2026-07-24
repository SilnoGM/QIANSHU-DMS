import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import {
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { AuditEventListQueryDto } from './audit-event-list-query.dto'

function validationProperties(
  errors: Awaited<ReturnType<typeof validate>>,
): string[] {
  return errors.map(error => error.property).sort()
}

describe('AuditEventListQueryDto', () => {
  it('transforms and accepts the two documented pagination fields', async () => {
    const input = plainToInstance(AuditEventListQueryDto, {
      page: '2',
      pageSize: '50',
    })

    await expect(validate(input)).resolves.toEqual([])
    expect(input.page).toBe(2)
    expect(input.pageSize).toBe(50)
  })

  it('rejects pagination values outside the documented boundary', async () => {
    const input = plainToInstance(AuditEventListQueryDto, {
      page: '0',
      pageSize: '101',
    })

    expect(validationProperties(await validate(input))).toEqual([
      'page',
      'pageSize',
    ])
  })

  it('接受精确 requestId、eventType 与 outcome 查询条件', async () => {
    const input = plainToInstance(AuditEventListQueryDto, {
      requestId: 'request-123',
      eventType: AuditEventType.USER_UPDATED,
      outcome: AuditOutcome.FAILURE,
    })

    await expect(validate(input)).resolves.toEqual([])
    expect(input).toMatchObject({
      requestId: 'request-123',
      eventType: AuditEventType.USER_UPDATED,
      outcome: AuditOutcome.FAILURE,
    })
  })

  it('按 Unicode code point 接受 64 个双码元字符的 requestId', async () => {
    const input = plainToInstance(AuditEventListQueryDto, {
      requestId: '😀'.repeat(64),
    })

    await expect(validate(input)).resolves.toEqual([])
  })

  it('拒绝空 requestId、超长 requestId 与未知枚举值', async () => {
    const emptyRequestId = plainToInstance(AuditEventListQueryDto, {
      requestId: '',
    })
    const longRequestId = plainToInstance(AuditEventListQueryDto, {
      requestId: '😀'.repeat(65),
    })
    const invalidEnums = plainToInstance(AuditEventListQueryDto, {
      eventType: 'UNKNOWN_EVENT',
      outcome: 'UNKNOWN_OUTCOME',
    })

    expect(validationProperties(await validate(emptyRequestId))).toEqual([
      'requestId',
    ])
    expect(validationProperties(await validate(longRequestId))).toEqual([
      'requestId',
    ])
    expect(validationProperties(await validate(invalidEnums))).toEqual([
      'eventType',
      'outcome',
    ])
  })
})

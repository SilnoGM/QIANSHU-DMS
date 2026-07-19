import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

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
})

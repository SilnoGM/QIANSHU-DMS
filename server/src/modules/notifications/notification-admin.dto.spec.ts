import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { NotificationTemplateCreateDto } from './notification-admin.dto'

function createPayload(mediaPolicy?: Record<string, unknown>): Record<string, unknown> {
  return {
    key: 'sales.order.submitted.XZL',
    channel: 'WECOM',
    name: '销售单提交通知',
    domain: 'SALES',
    bodyTemplate: '销售单 {{orderNo}} 已提交',
    variables: [{ name: 'orderNo', required: true, maxLength: 64, sensitive: false }],
    ...(mediaPolicy === undefined ? {} : { mediaPolicy }),
  }
}

async function violationPaths(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(NotificationTemplateCreateDto, payload)
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true })
  const paths: string[] = []
  const walk = (list: typeof errors, prefix: string): void => {
    for (const error of list) {
      const path = prefix === '' ? error.property : `${prefix}.${error.property}`
      if (Object.keys(error.constraints ?? {}).length > 0) {
        paths.push(path)
      }
      walk(error.children ?? [], path)
    }
  }
  walk(errors, '')
  return paths.sort()
}

describe('NotificationTemplateCreateDto media policy contract', () => {
  it('accepts the disabled policy payload the template form submits', async () => {
    await expect(violationPaths(createPayload({ enabled: false }))).resolves.toEqual([])
  })

  // 关闭附件时前端不能补 maxCount:0：DTO 的下限是 1，禁用语义只由 enabled=false 表达。
  it('rejects maxCount 0 in a disabled policy payload', async () => {
    await expect(violationPaths(createPayload({ enabled: false, maxCount: 0 })))
      .resolves.toEqual(['mediaPolicy.maxCount'])
  })
})

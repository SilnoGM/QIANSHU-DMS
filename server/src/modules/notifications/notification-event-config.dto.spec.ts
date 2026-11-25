import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { NotificationEventConfigUpdateDto } from './notification-admin.dto'

function payload(channels: unknown[]): Record<string, unknown> {
  return { channels }
}

function inAppChannel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel: 'IN_APP',
    sendMethod: 'IN_APP',
    targetMode: 'USERS',
    targetConfig: { userIds: [] },
    expectedVersion: 0,
    messages: [{ kind: 'TEXT', payload: { content: '正文' } }],
    ...overrides,
  }
}

async function violationPaths(input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(NotificationEventConfigUpdateDto, input)
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

describe('NotificationEventConfigUpdateDto', () => {
  it('accepts one in-app channel with text content', async () => {
    await expect(violationPaths(payload([inAppChannel()]))).resolves.toEqual([])
  })

  it('rejects more than two channels', async () => {
    await expect(violationPaths(payload([
      inAppChannel(),
      inAppChannel({ channel: 'WECOM', sendMethod: 'APP' }),
      inAppChannel({ channel: 'WECOM', sendMethod: 'ROBOT', targetMode: 'GROUP' }),
    ]))).resolves.toContain('channels')
  })

  it('rejects a negative expectedVersion and missing messages', async () => {
    await expect(violationPaths(payload([
      inAppChannel({ expectedVersion: -1, messages: undefined }),
    ]))).resolves.toEqual(expect.arrayContaining([
      'channels.0.expectedVersion',
      'channels.0.messages',
    ]))
  })

  it('rejects an unknown message kind and extra fields', async () => {
    await expect(violationPaths(payload([
      inAppChannel({
        messages: [{ kind: 'UNKNOWN', payload: { content: '正文' }, extra: true }],
      }),
    ]))).resolves.toEqual(expect.arrayContaining([
      'channels.0.messages.0.kind',
      'channels.0.messages.0.extra',
    ]))
  })
})

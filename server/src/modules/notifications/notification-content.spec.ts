import {
  hashNotificationContent,
  validateNotificationContentGroup,
} from './notification-content'

const COVER_ID = '00000000-0000-4000-8000-000000000001'

function text(content: string) {
  return { kind: 'TEXT' as const, payload: { content } }
}

function mpnews(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'MPNEWS' as const,
    payload: {
      cover: { mediaAssetId: COVER_ID },
      title: '采购流程调整通知',
      author: '千树 DMS',
      digest: '流程调整说明',
      contentSourceUrl: 'https://dms.example.com/notice/1',
      content: '<p>正文</p><img data-asset-id="' + COVER_ID + '" alt="示意图">',
      ...overrides,
    },
  }
}

describe('notification content group validation', () => {
  it('accepts a single in-app text item', () => {
    const result = validateNotificationContentGroup({
      method: 'IN_APP',
      items: [text('销售单 {{orderNo}} 已提交')],
      allowedVariables: ['orderNo'],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.sortOrder).toBe(0)
      expect(result.items[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u)
    }
  })

  it('rejects in-app multiple enabled items', () => {
    const result = validateNotificationContentGroup({
      method: 'IN_APP',
      items: [text('a'), text('b')],
      allowedVariables: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_IN_APP_SINGLE_ITEM')
    }
  })

  it('rejects empty content and undeclared variables', () => {
    const empty = validateNotificationContentGroup({
      method: 'APP',
      items: [text('')],
      allowedVariables: null,
    })
    expect(empty.ok).toBe(false)

    const undeclared = validateNotificationContentGroup({
      method: 'APP',
      items: [text('{{unknown}}')],
      allowedVariables: ['orderNo'],
    })
    expect(undeclared.ok).toBe(false)
    if (!undeclared.ok) {
      expect(undeclared.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_UNDECLARED_VARIABLE')
    }
  })

  it('rejects single braces and unsafe links', () => {
    const singleBrace = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'TEXT', payload: { content: '单号 {orderNo}' } }],
      allowedVariables: ['orderNo'],
    })
    expect(singleBrace.ok).toBe(false)

    const unsafeLink = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'TEXT', payload: { content: '正文', linkUrl: 'javascript:alert(1)' } }],
      allowedVariables: null,
    })
    expect(unsafeLink.ok).toBe(false)
    if (!unsafeLink.ok) {
      expect(unsafeLink.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_LINK_INVALID')
    }
  })

  it('accepts a valid mpnews only for app messages', () => {
    const app = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews()],
      allowedVariables: null,
    })
    expect(app.ok).toBe(true)

    const robot = validateNotificationContentGroup({
      method: 'ROBOT',
      items: [mpnews()],
      allowedVariables: null,
    })
    expect(robot.ok).toBe(false)
    if (!robot.ok) {
      expect(robot.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_KIND_UNSUPPORTED')
    }
  })

  it('rejects mpnews without cover, external images and unsafe html', () => {
    const missingCover = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'MPNEWS', payload: { ...mpnews().payload, cover: {} } }],
      allowedVariables: null,
    })
    expect(missingCover.ok).toBe(false)

    const externalImage = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews({ content: '<p>正文</p><img src="https://external.example.com/a.png">' })],
      allowedVariables: null,
    })
    expect(externalImage.ok).toBe(false)
    if (!externalImage.ok) {
      expect(externalImage.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_IMAGE_INVALID')
    }

    const script = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews({ content: '<script>alert(1)</script>' })],
      allowedVariables: null,
    })
    expect(script.ok).toBe(false)
    if (!script.ok) {
      expect(script.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_HTML_UNSAFE')
    }
  })

  it('rejects multiple mpnews items', () => {
    const result = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews(), mpnews()],
      allowedVariables: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_MPSNEWS_MULTIPLE')
    }
  })

  it('rejects unimplemented message kinds', () => {
    const result = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'IMAGE', payload: {} }],
      allowedVariables: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_KIND_UNSUPPORTED')
    }
  })

  it('normalizes sort order and hashes content', () => {
    const result = validateNotificationContentGroup({
      method: 'APP',
      items: [
        { ...text('第二'), sortOrder: 9 },
        { ...text('第一'), sortOrder: 1 },
      ],
      allowedVariables: null,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items.map(item => item.payload.content)).toEqual(['第一', '第二'])
      expect(result.items.map(item => item.sortOrder)).toEqual([0, 1])
      expect(result.items[0]?.contentHash).toBe(hashNotificationContent({
        kind: 'TEXT',
        payload: { title: null, content: '第一', linkUrl: null },
        mediaPolicy: {},
      }))
    }
  })
})

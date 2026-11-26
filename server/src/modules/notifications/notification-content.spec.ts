import {
  hashNotificationContent,
  renderMpnewsHtml,
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

  it('rejects undeclared variables in mpnews author', () => {
    const result = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews({ author: '{{unknown}} 发布' })],
      allowedVariables: ['orderNo'],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'NOTIFICATION_CONTENT_UNDECLARED_VARIABLE',
        field: 'author',
      }))
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
      expect(externalImage.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_HTML_UNSAFE')
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

  it('enforces the mpnews HTML allowlist instead of only blocking known-dangerous tags', () => {
    const invalidContents = [
      '<style>p{color:red}</style>',
      '<p onclick="alert(1)">正文</p>',
      '<a href=https://example.com>链接</a>',
      '<a href="javascript:alert(1)">链接</a>',
      '<p><strong>正文</p></strong>',
      '<img data-asset-id="not-a-uuid">',
      '<p>正文</p><!-- comment -->',
    ]
    for (const content of invalidContents) {
      const result = validateNotificationContentGroup({
        method: 'APP',
        items: [mpnews({ content })],
        allowedVariables: null,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_HTML_UNSAFE')
      }
    }

    const valid = '<p>正文 <strong>加粗</strong><br><a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer nofollow">链接</a></p><ul><li>一</li></ul><img data-asset-id="00000000-0000-4000-8000-000000000001" alt="图">'
    const accepted = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews({ content: valid })],
      allowedVariables: null,
    })
    expect(accepted.ok).toBe(true)

    const rendered = renderMpnewsHtml({
      html: valid,
      variables: {},
      allowed: [],
      allowSensitive: true,
    })
    expect(rendered.ok).toBe(true)
    const blocked = renderMpnewsHtml({
      html: '<p>正文</p><script>alert(1)</script>',
      variables: {},
      allowed: [],
      allowSensitive: true,
    })
    expect(blocked).toMatchObject({ ok: false, code: 'NOTIFICATION_CONTENT_HTML_UNSAFE' })
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
      items: [{ kind: 'VIDEO', payload: {} }],
      allowedVariables: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_KIND_UNSUPPORTED')
    }
  })

  it('accepts an image attachment item within the event media contract', () => {
    const result = validateNotificationContentGroup({
      method: 'APP',
      items: [
        text('采购单已审核通过'),
        {
          kind: 'IMAGE',
          payload: {},
          mediaPolicy: { sourceKeys: ['purchase.orderImage'], maxCount: 1 },
        },
      ],
      allowedVariables: null,
      mediaSources: ['purchase.orderImage', 'purchase.paymentVoucher'],
      mediaMaxCount: 2,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items[1]).toMatchObject({
        kind: 'IMAGE',
        payload: {},
        mediaPolicy: { sourceKeys: ['purchase.orderImage'], maxCount: 1 },
      })
    }
  })

  it('allows an empty source list to mean every declared source', () => {
    const result = validateNotificationContentGroup({
      method: 'ROBOT',
      items: [
        text('收款水单已发送'),
        {
          kind: 'IMAGE',
          payload: {},
          mediaPolicy: { sourceKeys: [], maxCount: 2 },
        },
      ],
      allowedVariables: null,
      mediaSources: ['salesReceipt.voucher'],
      mediaMaxCount: 2,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items[1]?.mediaPolicy).toEqual({ sourceKeys: [], maxCount: 2 })
    }
  })

  it.each([
    ['an event without media capability', { mediaSources: null, mediaMaxCount: 0 }, 'NOTIFICATION_CONTENT_MEDIA_UNSUPPORTED'],
    ['an undeclared source', { mediaSources: ['salesReceipt.voucher'], mediaMaxCount: 2 }, 'NOTIFICATION_CONTENT_MEDIA_SOURCE_INVALID'],
    ['a limit above the event cap', { mediaSources: ['salesReceipt.voucher'], mediaMaxCount: 2 }, 'NOTIFICATION_CONTENT_MEDIA_LIMIT_INVALID'],
    ['a malformed policy', { mediaSources: ['salesReceipt.voucher'], mediaMaxCount: 2 }, 'NOTIFICATION_CONTENT_MEDIA_POLICY_INVALID'],
  ])('rejects an image item with %s', (_label, contract, code) => {
    const mediaPolicy = code === 'NOTIFICATION_CONTENT_MEDIA_POLICY_INVALID'
      ? { sourceKeys: ['salesReceipt.voucher', 'salesReceipt.voucher'], maxCount: 1 }
      : code === 'NOTIFICATION_CONTENT_MEDIA_LIMIT_INVALID'
        ? { sourceKeys: ['salesReceipt.voucher'], maxCount: 3 }
        : { sourceKeys: code === 'NOTIFICATION_CONTENT_MEDIA_SOURCE_INVALID' ? ['other.source'] : ['salesReceipt.voucher'], maxCount: 1 }
    const result = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'IMAGE', payload: {}, mediaPolicy }],
      allowedVariables: null,
      ...contract,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(item => item.code)).toContain(code)
    }
  })

  it('does not allow image attachments on in-app notifications', () => {
    const result = validateNotificationContentGroup({
      method: 'IN_APP',
      items: [{ kind: 'IMAGE', payload: {}, mediaPolicy: { sourceKeys: [], maxCount: 1 } }],
      allowedVariables: null,
      mediaSources: ['salesReceipt.voucher'],
      mediaMaxCount: 1,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_KIND_UNSUPPORTED')
    }
  })

  it('requires a text or mpnews body alongside image attachments', () => {
    const result = validateNotificationContentGroup({
      method: 'APP',
      items: [{
        kind: 'IMAGE',
        payload: {},
        mediaPolicy: { sourceKeys: ['salesReceipt.voucher'], maxCount: 1 },
      }],
      allowedVariables: null,
      mediaSources: ['salesReceipt.voucher'],
      mediaMaxCount: 1,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_TEXT_REQUIRED')
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

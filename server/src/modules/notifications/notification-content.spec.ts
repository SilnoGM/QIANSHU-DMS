import {
  extractNotificationContentAssetIds,
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

function news(articles: readonly Record<string, unknown>[] = [{
  title: '订单通知',
  description: '请查收订单资料',
  url: 'https://dms.example.com/sales/1',
  imageAssetId: COVER_ID,
}]) {
  return { kind: 'NEWS' as const, payload: { articles } }
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

  it('allows in-app route links but keeps WeCom links absolute', () => {
    const inApp = validateNotificationContentGroup({
      method: 'IN_APP',
      items: [{ kind: 'TEXT', payload: { content: '查看详情', linkUrl: '/qs-finance/realtime-payments/sales-receipts' } }],
      allowedVariables: null,
    })
    expect(inApp.ok).toBe(true)

    const protocolRelative = validateNotificationContentGroup({
      method: 'IN_APP',
      items: [{ kind: 'TEXT', payload: { content: '查看详情', linkUrl: '//evil.example/path' } }],
      allowedVariables: null,
    })
    expect(protocolRelative.ok).toBe(false)

    const wecom = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'TEXT', payload: { content: '查看详情', linkUrl: '/qs-finance/realtime-payments/sales-receipts' } }],
      allowedVariables: null,
    })
    expect(wecom.ok).toBe(false)
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

  it('accepts markdown and textcard on supported methods', () => {
    const markdownApp = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'MARKDOWN', payload: { content: '## 标题\n\n正文' } }],
      allowedVariables: null,
    })
    expect(markdownApp.ok).toBe(true)

    const markdownV2Robot = validateNotificationContentGroup({
      method: 'ROBOT',
      items: [{ kind: 'MARKDOWN_V2', payload: { content: '| A | B |\n|---|---|\n| 1 | 2 |' } }],
      allowedVariables: null,
    })
    expect(markdownV2Robot.ok).toBe(true)

    const textcard = validateNotificationContentGroup({
      method: 'APP',
      items: [{
        kind: 'TEXTCARD',
        payload: {
          title: '采购通知',
          description: '采购单已审核通过',
          url: 'https://dms.example.com/purchase/1',
          btntxt: '详情',
        },
      }],
      allowedVariables: null,
    })
    expect(textcard.ok).toBe(true)
  })

  it('accepts fixed and dynamic file messages', () => {
    const assetId = '00000000-0000-4000-8000-000000000222'
    const fixed = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'FILE', payload: { mediaAssetId: assetId }, mediaPolicy: {} }],
      allowedVariables: null,
    })
    expect(fixed.ok).toBe(true)

    const dynamic = validateNotificationContentGroup({
      method: 'ROBOT',
      items: [{
        kind: 'FILE',
        payload: { mediaAssetId: null },
        mediaPolicy: { sourceKeys: ['purchase.deliveryFile'], maxCount: 1 },
      }],
      allowedVariables: null,
      mediaSources: ['purchase.deliveryFile'],
      mediaMaxCount: 3,
    })
    expect(dynamic.ok).toBe(true)
  })

  it('rejects file message without media or with ambiguous media sources', () => {
    const empty = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'FILE', payload: {}, mediaPolicy: {} }],
      allowedVariables: null,
    })
    expect(empty.ok).toBe(false)

    const ambiguous = validateNotificationContentGroup({
      method: 'APP',
      items: [{
        kind: 'FILE',
        payload: { mediaAssetId: '00000000-0000-4000-8000-000000000222' },
        mediaPolicy: { sourceKeys: ['purchase.deliveryFile'], maxCount: 1 },
      }],
      allowedVariables: null,
      mediaSources: ['purchase.deliveryFile'],
    })
    expect(ambiguous.ok).toBe(false)

    const undeclared = validateNotificationContentGroup({
      method: 'ROBOT',
      items: [{
        kind: 'FILE',
        payload: {},
        mediaPolicy: { sourceKeys: ['unknown.file'], maxCount: 1 },
      }],
      allowedVariables: null,
      mediaSources: ['purchase.deliveryFile'],
    })
    expect(undeclared.ok).toBe(false)
  })

  it('accepts news cards on app and robot with article images', () => {
    const app = validateNotificationContentGroup({
      method: 'APP',
      items: [news()],
      allowedVariables: null,
    })
    expect(app.ok).toBe(true)
    if (app.ok) {
      expect(app.items[0]?.payload).toEqual({
        articles: [{
          title: '订单通知',
          description: '请查收订单资料',
          url: 'https://dms.example.com/sales/1',
          imageAssetId: COVER_ID,
        }],
      })
    }

    const robot = validateNotificationContentGroup({
      method: 'ROBOT',
      items: [news([
        { title: '第一篇', description: null, url: 'https://dms.example.com/1', imageAssetId: null },
        { title: '第二篇', description: '', url: 'https://dms.example.com/2', imageAssetId: COVER_ID },
      ])],
      allowedVariables: null,
    })
    expect(robot.ok).toBe(true)
    if (robot.ok) {
      expect((robot.items[0]?.payload as { articles: unknown[] }).articles).toHaveLength(2)
    }

    expect(extractNotificationContentAssetIds(news([
      { title: '第一篇', description: null, url: 'https://dms.example.com/1', imageAssetId: COVER_ID },
      { title: '第二篇', description: null, url: 'https://dms.example.com/2', imageAssetId: COVER_ID },
    ]))).toMatchObject({ newsImageAssetIds: [COVER_ID] })
  })

  it('rejects news cards outside the article and field limits', () => {
    const tooMany = validateNotificationContentGroup({
      method: 'APP',
      items: [news(Array.from({ length: 9 }, (_, index) => ({
        title: `文章 ${index + 1}`,
        description: null,
        url: 'https://dms.example.com/1',
        imageAssetId: null,
      })))],
      allowedVariables: null,
    })
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) {
      expect(tooMany.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_NEWS_ARTICLE_COUNT')
      expect(tooMany.issues.find(item => item.code === 'NOTIFICATION_CONTENT_NEWS_ARTICLE_COUNT')?.field).toBe('articles')
    }

    const invalid = validateNotificationContentGroup({
      method: 'APP',
      items: [news([{
        title: ' ',
        description: 'x'.repeat(513),
        url: 'ftp://example.test/file',
        imageAssetId: 'not-a-uuid',
      }])],
      allowedVariables: null,
    })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) {
      const fields = invalid.issues.map(item => item.field)
      expect(fields).toEqual(expect.arrayContaining([
        'articles.0.title',
        'articles.0.description',
        'articles.0.url',
        'articles.0.imageAssetId',
      ]))
      expect(invalid.issues.every(item => item.itemIndex === 0)).toBe(true)
    }

    const unknownVariable = validateNotificationContentGroup({
      method: 'APP',
      items: [news([{
        title: '{{unknown}}',
        description: null,
        url: 'https://dms.example.com/1',
        imageAssetId: null,
      }])],
      allowedVariables: ['customerName'],
    })
    expect(unknownVariable.ok).toBe(false)
    if (!unknownVariable.ok) {
      expect(unknownVariable.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_UNDECLARED_VARIABLE')
    }
  })

  it('rejects textcard with unsafe link and markdown on unsupported method', () => {
    const unsafe = validateNotificationContentGroup({
      method: 'APP',
      items: [{
        kind: 'TEXTCARD',
        payload: {
          title: '采购通知',
          description: '描述',
          url: 'javascript:alert(1)',
        },
      }],
      allowedVariables: null,
    })
    expect(unsafe.ok).toBe(false)
    if (!unsafe.ok) {
      expect(unsafe.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_TEXTCARD_URL_INVALID')
    }

    const v2App = validateNotificationContentGroup({
      method: 'APP',
      items: [{ kind: 'MARKDOWN_V2', payload: { content: '正文' } }],
      allowedVariables: null,
    })
    expect(v2App.ok).toBe(false)
  })


  it('accepts mpnews business image placeholders with declared sources and static text', () => {
    const content = '<p>附件如下：</p><img data-media-source="salesOrder.issuanceVoucher" alt="出单凭证">'
    const result = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews({ content })],
      allowedVariables: null,
      mediaSources: ['salesOrder.issuanceVoucher'],
      mediaMaxCount: 3,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects undeclared, over-limit and text-less business image placeholders', () => {
    const undeclared = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews({ content: '<p>附件：</p><img data-media-source="unknown.source">' })],
      allowedVariables: null,
      mediaSources: ['salesOrder.issuanceVoucher'],
      mediaMaxCount: 3,
    })
    expect(undeclared.ok).toBe(false)
    if (!undeclared.ok) {
      expect(undeclared.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_MEDIA_SOURCE_UNDECLARED')
    }

    const overLimit = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews({
        content: '<p>附件：</p><img data-media-source="salesOrder.issuanceVoucher"><img data-media-source="salesOrder.issuanceVoucher">',
      })],
      allowedVariables: null,
      mediaSources: ['salesOrder.issuanceVoucher'],
      mediaMaxCount: 1,
    })
    expect(overLimit.ok).toBe(false)
    if (!overLimit.ok) {
      expect(overLimit.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_INLINE_MEDIA_LIMIT')
    }

    const textless = validateNotificationContentGroup({
      method: 'APP',
      items: [mpnews({ content: '<img data-media-source="salesOrder.issuanceVoucher">' })],
      allowedVariables: null,
      mediaSources: ['salesOrder.issuanceVoucher'],
      mediaMaxCount: 3,
    })
    expect(textless.ok).toBe(false)
    if (!textless.ok) {
      expect(textless.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_MPSNEWS_STATIC_TEXT_REQUIRED')
    }
  })

  it('rejects ambiguous or sourceless mpnews image tags', () => {
    for (const content of [
      `<p>正文</p><img data-asset-id="${COVER_ID}" data-media-source="salesOrder.issuanceVoucher">`,
      '<p>正文</p><img alt="没有来源">',
    ]) {
      const result = validateNotificationContentGroup({
        method: 'APP',
        items: [mpnews({ content })],
        allowedVariables: null,
        mediaSources: ['salesOrder.issuanceVoucher'],
        mediaMaxCount: 3,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues.map(item => item.code)).toContain('NOTIFICATION_CONTENT_HTML_UNSAFE')
      }
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
      expect(result.items.map(item => 'content' in item.payload ? item.payload.content : '')).toEqual(['第一', '第二'])
      expect(result.items.map(item => item.sortOrder)).toEqual([0, 1])
      expect(result.items[0]?.contentHash).toBe(hashNotificationContent({
        kind: 'TEXT',
        payload: { title: null, content: '第一', linkUrl: null },
        mediaPolicy: {},
      }))
    }
  })
})

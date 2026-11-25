import { normalizeWecomWebhookKey } from './wecom-webhook'

describe('normalizeWecomWebhookKey', () => {
  it('accepts a raw robot key', () => {
    expect(normalizeWecomWebhookKey('693a91f6-7f7e-4bc4-97a0-0ec2sifa5aaa'))
      .toEqual({ ok: true, key: '693a91f6-7f7e-4bc4-97a0-0ec2sifa5aaa' })
  })

  it('extracts the key from a canonical WeCom webhook URL', () => {
    expect(normalizeWecomWebhookKey('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123'))
      .toEqual({ ok: true, key: 'abc-123' })
  })

  it('rejects URLs from another host or path', () => {
    expect(normalizeWecomWebhookKey('https://example.com/cgi-bin/webhook/send?key=abc-123').ok).toBe(false)
    expect(normalizeWecomWebhookKey('https://qyapi.weixin.qq.com/cgi-bin/message/send?key=abc-123').ok).toBe(false)
    expect(normalizeWecomWebhookKey('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123').ok).toBe(false)
  })

  it('rejects a URL without a key or a raw value containing URL syntax', () => {
    expect(normalizeWecomWebhookKey('https://qyapi.weixin.qq.com/cgi-bin/webhook/send').ok).toBe(false)
    expect(normalizeWecomWebhookKey('abc/def?key=123').ok).toBe(false)
    expect(normalizeWecomWebhookKey('  ').ok).toBe(false)
  })
})

import { normalizeUsername } from './username-normalizer'

describe('normalizeUsername', () => {
  it('保留 NFC 与 trim 后的登录名作为展示值，并生成 lowercase 唯一键', () => {
    expect(normalizeUsername('  A\u030AlicE  ')).toEqual({
      username: 'ÅlicE',
      usernameNormalized: 'ålice',
    })
  })

  it('只移除两端空白，不折叠或删除登录名内部空白', () => {
    expect(normalizeUsername('\u3000Alice  Smith\u00a0')).toEqual({
      username: 'Alice  Smith',
      usernameNormalized: 'alice  smith',
    })
  })

  it('对已经规范化的登录名保持幂等', () => {
    const first = normalizeUsername('  用户A  ')

    expect(normalizeUsername(first.username)).toEqual(first)
  })
})

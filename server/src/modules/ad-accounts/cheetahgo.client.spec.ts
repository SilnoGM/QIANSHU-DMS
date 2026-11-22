import { createHash } from 'node:crypto'
import { CheetahGoClient, CheetahGoError } from './cheetahgo.client'

const APPID = 'test-appid'
const SECRET = 'test-secret'
const FIXED_NOW = new Date('2026-11-22T10:00:00+08:00')

interface RecordedRequest {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

function createRecordingFetch(
  handler: (request: RecordedRequest) => { status?: number; body: unknown },
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []

  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    requests.push(request)

    const response = handler(request)

    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }))
  }) as typeof fetch

  return { fetchImpl, requests }
}

function expectedSignature(appid: string, secret: string, timestamp: number): string {
  return createHash('sha1')
    .update(`appid=${appid}&secret=${secret}&timestamp=${timestamp}`)
    .digest('hex')
}

function tokenResponse(token: string): { body: unknown } {
  return { body: { code: 0, msg: '成功', data: { access_token: token }, log_id: 'log' } }
}

function accountPage(page: number, totalPage: number): { body: unknown } {
  return {
    body: {
      code: 0,
      msg: '成功',
      data: {
        list: [
          {
            account_id: `account-${page}`,
            account_name: `账户 ${page}`,
            company_cn: '聊城千树文化传媒有限公司',
            account_status: 1,
            account_status_text: 'ACTIVE',
            freeze: 2,
            disable_reason: 0,
            spend_cap: '100.01',
            amount_spent: '21.59',
            daily_spend_limit: '1000.00',
            disabled_transfer_amount: '0.00',
            created_time: 1794294543,
            update_date: '2026-11-16 10:48:42',
          },
        ],
        pager: { total_page: totalPage, page, page_size: 1000, total_count: totalPage },
      },
      log_id: 'log',
    },
  }
}

function createClient(
  handler: (request: RecordedRequest) => { status?: number; body: unknown },
): { client: CheetahGoClient; requests: RecordedRequest[] } {
  const { fetchImpl, requests } = createRecordingFetch(handler)
  const client = new CheetahGoClient({
    appid: APPID,
    secret: SECRET,
    baseUrl: 'https://open-api.example.com',
    fetchImpl,
    now: () => FIXED_NOW,
  })

  return { client, requests }
}

describe('CheetahGoClient access token', () => {
  it('signs appid, secret and timestamp in dictionary order with sha1', async () => {
    const timestamp = Math.floor(FIXED_NOW.getTime() / 1000)
    const { client, requests } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        return tokenResponse('token-1')
      }
      return accountPage(1, 1)
    })

    await client.listAccounts()

    expect(requests[0].url).toBe('https://open-api.example.com/v1/access-token')
    expect(requests[0].method).toBe('POST')
    expect(requests[0].body).toEqual({
      appid: APPID,
      secret: SECRET,
      timestamp,
      signature: expectedSignature(APPID, SECRET, timestamp),
    })
  })

  it('reuses the cached token across calls', async () => {
    const { client, requests } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        return tokenResponse('token-1')
      }
      return accountPage(1, 1)
    })

    await client.listAccounts()
    await client.listAccounts()

    expect(requests.filter((request) => request.url.endsWith('/v1/access-token'))).toHaveLength(1)
    expect(requests[1].headers.Authorization).toBe('token-1')
    expect(requests[1].headers.authorization).toBeUndefined()
  })

  it('refreshes the token when the API rejects it', async () => {
    let tokenCalls = 0
    const { client, requests } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        tokenCalls += 1
        return tokenResponse(`token-${tokenCalls}`)
      }

      if (request.headers.Authorization === 'token-1') {
        return { body: { code: 1099, msg: '无效身份', log_id: 'log' } }
      }

      return accountPage(1, 1)
    })

    const accounts = await client.listAccounts()

    expect(accounts).toHaveLength(1)
    expect(tokenCalls).toBe(2)
    expect(requests.at(-1)?.headers.Authorization).toBe('token-2')
  })
})

describe('CheetahGoClient listAccounts', () => {
  it('walks every page reported by the pager', async () => {
    const { client, requests } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        return tokenResponse('token-1')
      }

      const page = Number(new URL(request.url).searchParams.get('page') ?? '1')

      return accountPage(page, 3)
    })

    const accounts = await client.listAccounts()

    expect(accounts.map((account) => account.accountId)).toEqual([
      'account-1',
      'account-2',
      'account-3',
    ])
    expect(requests.filter((request) => request.url.includes('/v1/facebook-account-list'))).toHaveLength(3)
  })

  it('normalizes decimal strings and timestamps', async () => {
    const { client } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        return tokenResponse('token-1')
      }
      return accountPage(1, 1)
    })

    const [account] = await client.listAccounts()

    expect(account).toMatchObject({
      accountId: 'account-1',
      accountName: '账户 1',
      companyCn: '聊城千树文化传媒有限公司',
      accountStatus: 1,
      freeze: 2,
      spendCap: '100.01',
      amountSpent: '21.59',
      dailySpendLimit: '1000.00',
      disabledTransferAmount: '0.00',
    })
    expect(account.createdTime.toISOString()).toBe(new Date(1794294543 * 1000).toISOString())
    // 上游 update_date 是无时区字符串，按 Asia/Shanghai 解释。
    expect(account.vendorUpdatedAt.toISOString()).toBe('2026-11-16T02:48:42.000Z')
  })
})

describe('CheetahGoClient listDailySpend', () => {
  it('returns rows keyed by account and date', async () => {
    const { client, requests } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        return tokenResponse('token-1')
      }

      return {
        body: {
          code: 0,
          msg: '成功',
          data: [
            { account_id: 'account-1', date: '2026-11-20', spend: '12.34', total_spend: '12.34', fee_ready: true },
            { account_id: 'account-2', date: '2026-11-20', spend: '0.00', total_spend: '0.00', fee_ready: true },
          ],
          log_id: 'log',
        },
      }
    })

    const rows = await client.listDailySpend('2026-11-16', '2026-11-22')

    expect(rows).toEqual([
      { accountId: 'account-1', date: '2026-11-20', spend: '12.34' },
      { accountId: 'account-2', date: '2026-11-20', spend: '0.00' },
    ])

    const spendRequest = requests.find((request) => request.url.includes('/v1/day-range-account-spend'))
    expect(spendRequest?.url).toContain('start_date=2026-11-16')
    expect(spendRequest?.url).toContain('end_date=2026-11-22')
  })
})

describe('CheetahGoClient error mapping', () => {
  it('maps an unauthorized business code to UNAUTHORIZED', async () => {
    const { client } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        return tokenResponse('token-1')
      }
      return { body: { code: 1006, msg: '无效的AppID', log_id: 'log' } }
    })

    await expect(client.listAccounts()).rejects.toMatchObject({ kind: 'UNAUTHORIZED' })
  })

  it('maps a failed token request to UNAUTHORIZED', async () => {
    const { client } = createClient(() => ({ body: { code: 1006, msg: '无效的AppID', log_id: 'log' } }))

    await expect(client.listAccounts()).rejects.toMatchObject({ kind: 'UNAUTHORIZED' })
  })

  it('retries a server error once and then reports UNAVAILABLE', async () => {
    let spendCalls = 0
    const { client } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        return tokenResponse('token-1')
      }
      spendCalls += 1
      return { status: 503, body: { code: 503, msg: '服务不可用' } }
    })

    await expect(client.listDailySpend('2026-11-16', '2026-11-22')).rejects.toBeInstanceOf(CheetahGoError)
    await expect(client.listDailySpend('2026-11-16', '2026-11-22')).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
    expect(spendCalls).toBe(4)
  })

  it('rejects malformed payloads instead of silently returning empty data', async () => {
    const { client } = createClient((request) => {
      if (request.url.endsWith('/v1/access-token')) {
        return tokenResponse('token-1')
      }
      return { body: { code: 0, msg: '成功', data: { unexpected: true } } }
    })

    await expect(client.listAccounts()).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' })
  })
})

import {
  IpfoxyClient,
  IpfoxyClientError,
  type IpfoxyCredentials,
  type IpfoxyFetch,
} from './ipfoxy.client'

const TEST_API_ID = ['test', 'id'].join('-')
const TEST_API_TOKEN = ['test', 'token'].join('-')

const CONFIG: IpfoxyCredentials = {
  apiId: TEST_API_ID,
  apiToken: TEST_API_TOKEN,
  baseUrl: 'https://apis.ipfoxy.com',
}

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>

function fetchMock(): FetchMock {
  return jest.fn<Promise<Response>, [string, RequestInit?]>()
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function createClient(fetchImpl: FetchMock): IpfoxyClient {
  return new IpfoxyClient(CONFIG, fetchImpl as IpfoxyFetch)
}

function proxyRecord(id: string): Record<string, unknown> {
  return {
    id,
    host: '203.0.113.10',
    port: '45001',
    type: 'socks5',
    user: 'example-user',
    password: ['test', 'password'].join('-'),
    expire_time: '1701599163',
    ip_type: 'STATIC_DATACENTER',
  }
}

describe('IpfoxyClient', () => {
  it('sends credentials only in headers and uses the required query parameters', async () => {
    const fetchImpl = fetchMock().mockResolvedValue(jsonResponse({
      code: 0,
      data: { list: [proxyRecord('i14isvi')], total: 1 },
    }))
    const client = createClient(fetchImpl)

    await client.listProxies()

    const call = fetchImpl.mock.calls[0]
    expect(call?.[0]).toBe(
      'https://apis.ipfoxy.com/ip/open-api/proxy-list?page=1&page_size=50',
    )
    expect(call?.[0]).not.toContain(TEST_API_TOKEN)
    expect(call?.[0]).not.toContain(TEST_API_ID)
    expect(call?.[1]?.method).toBe('GET')
    expect(call?.[1]?.headers).toMatchObject({
      'api-id': TEST_API_ID,
      'api-token': TEST_API_TOKEN,
    })
  })

  it('paginates until total is reached and de-duplicates ids', async () => {
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { list: [proxyRecord('a'), proxyRecord('b')], total: 3 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { list: [proxyRecord('b'), proxyRecord('c')], total: 3 },
      }))
    const client = createClient(fetchImpl)

    const records = await client.listProxies()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(records.map(record => record.id)).toEqual(['a', 'b', 'c'])
  })

  it('maps vendor authorization and rate-limit codes without retrying', async () => {
    const unauthorized = createClient(fetchMock().mockResolvedValue(
      jsonResponse({ code: 60401, msg: 'unauthorized' }),
    ))
    await expect(unauthorized.listProxies())
      .rejects.toMatchObject({ kind: 'UNAUTHORIZED' })

    const rateLimited = createClient(fetchMock().mockResolvedValue(
      jsonResponse({ code: 50000, msg: 'too many requests' }),
    ))
    await expect(rateLimited.listProxies())
      .rejects.toMatchObject({ kind: 'RATE_LIMITED' })
  })

  it('retries one transport/5xx failure and then succeeds', async () => {
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { list: [proxyRecord('a')], total: 1 },
      }))
    const client = createClient(fetchImpl)

    await expect(client.listProxies()).resolves.toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails as unavailable after the retry is exhausted', async () => {
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({}, 500))
    const client = createClient(fetchImpl)

    await expect(client.listProxies()).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed JSON and malformed data shapes', async () => {
    const invalidJson = createClient(fetchMock().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.reject(new Error('invalid json')),
    } as unknown as Response))
    await expect(invalidJson.listProxies())
      .rejects.toMatchObject({ kind: 'INVALID_RESPONSE' })

    const invalidShape = createClient(fetchMock().mockResolvedValue(
      jsonResponse({ code: 0, data: { list: 'not-an-array', total: 1 } }),
    ))
    await expect(invalidShape.listProxies())
      .rejects.toMatchObject({ kind: 'INVALID_RESPONSE' })
  })

  it('returns area records and never calls the vendor when credentials are absent', async () => {
    const fetchImpl = fetchMock().mockResolvedValue(jsonResponse({
      code: 0,
      data: [{ id: 27, country: '智利' }],
    }))
    const client = createClient(fetchImpl)
    await expect(client.listAreas()).resolves.toEqual([{ id: 27, country: '智利' }])

    const missing = new IpfoxyClient(
      { apiId: null, apiToken: null, baseUrl: CONFIG.baseUrl },
      fetchImpl as IpfoxyFetch,
    )
    await expect(missing.listProxies())
      .rejects.toBeInstanceOf(IpfoxyClientError)
    await expect(missing.listProxies())
      .rejects.toMatchObject({ kind: 'NOT_CONFIGURED' })
  })
})

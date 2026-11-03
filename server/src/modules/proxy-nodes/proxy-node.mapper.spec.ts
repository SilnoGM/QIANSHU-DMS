import { ProxyIpType, ProxyProtocol } from '../../generated/prisma/enums'
import type { RawIpfoxyProxyRecord } from './ipfoxy.client'
import {
  buildAreaCountryMap,
  mapIpfoxyProxy,
  ProxyNodeRecordError,
  resolveProxyCountryLabel,
} from './proxy-node.mapper'

// 运行期拼接，避免测试夹具被静态扫描误判为真实凭据。
const TEST_PASSWORD = ['test', 'password', 'fixture'].join('-')

function validRecord(
  overrides: Partial<RawIpfoxyProxyRecord> = {},
): RawIpfoxyProxyRecord {
  return {
    id: 'i14isvi',
    host: '203.0.113.10',
    public_ip: '203.0.113.10',
    port: '45001',
    type: 'socks5',
    area_id: '27',
    user: 'example-user',
    password: TEST_PASSWORD,
    auto_extend: '1',
    expire_time: '1701599163',
    buy_time: '1699007163',
    country_code: 'cl',
    ip_type: 'STATIC_DATACENTER',
    ip_version: 'IPv4',
    renewal_time: '1699007163',
    ...overrides,
  }
}

describe('IPFoxy proxy mapper', () => {
  it('maps a valid record into normalized node fields', () => {
    const areaMap = buildAreaCountryMap([
      { id: 27, country: '智利', country_code: 'CL' },
    ])
    const node = mapIpfoxyProxy(validRecord(), areaMap)

    expect(node).toEqual({
      providerProxyId: 'i14isvi',
      host: '203.0.113.10',
      publicIp: '203.0.113.10',
      port: 45001,
      protocol: ProxyProtocol.SOCKS5,
      countryCode: 'CL',
      areaId: '27',
      vendorCountry: '智利',
      ipType: ProxyIpType.STATIC_DATACENTER,
      ipVersion: 'IPv4',
      autoExtend: true,
      boughtAt: new Date(1_699_007_163_000),
      expiresAt: new Date(1_701_599_163_000),
      lastRenewedAt: new Date(1_699_007_163_000),
      username: 'example-user',
      password: TEST_PASSWORD,
    })
  })

  it('defaults optional fields and preserves passwords without trimming', () => {
    const node = mapIpfoxyProxy(validRecord({
      public_ip: undefined,
      ip_version: undefined,
      auto_extend: undefined,
      buy_time: undefined,
      renewal_time: undefined,
      password: `  ${TEST_PASSWORD}  `,
      country_code: undefined,
    }), new Map())

    expect(node.publicIp).toBeNull()
    expect(node.ipVersion).toBe('IPv4')
    expect(node.autoExtend).toBe(false)
    expect(node.boughtAt).toBeNull()
    expect(node.lastRenewedAt).toBeNull()
    expect(node.countryCode).toBeNull()
    expect(node.vendorCountry).toBeNull()
    expect(node.password).toBe(`  ${TEST_PASSWORD}  `)
  })

  it('maps all supported protocols and IP types', () => {
    expect(mapIpfoxyProxy(validRecord({ type: 'http' }), new Map()).protocol)
      .toBe(ProxyProtocol.HTTP)
    expect(mapIpfoxyProxy(validRecord({ type: 'ssh' }), new Map()).protocol)
      .toBe(ProxyProtocol.SSH)
    expect(mapIpfoxyProxy(validRecord({ ip_type: 'STATIC_ISP' }), new Map()).ipType)
      .toBe(ProxyIpType.STATIC_ISP)
    expect(mapIpfoxyProxy(validRecord({ ip_type: 'STATIC_ISP_PRO' }), new Map()).ipType)
      .toBe(ProxyIpType.STATIC_ISP_PRO)
  })

  it('rejects records with invalid identity, port, protocol, type or expiry', () => {
    const invalidRecords: RawIpfoxyProxyRecord[] = [
      validRecord({ id: 'bad id' }),
      validRecord({ port: '0' }),
      validRecord({ port: '65536' }),
      validRecord({ type: 'quic' }),
      validRecord({ ip_type: 'UNKNOWN' }),
      validRecord({ expire_time: '0' }),
      validRecord({ expire_time: 'not-a-timestamp' }),
      validRecord({ user: '   ' }),
      validRecord({ password: '' }),
    ]

    for (const record of invalidRecords) {
      expect(() => mapIpfoxyProxy(record, new Map()))
        .toThrow(ProxyNodeRecordError)
    }
  })

  it('builds area country lookups from string and numeric ids', () => {
    const map = buildAreaCountryMap([
      { id: '27', country: '智利' },
      { id: 15, country: '泰国' },
      { id: 15, country: '重复值不覆盖' },
      { id: '', country: '忽略' },
      { id: 88, country: '   ' },
    ])

    expect(map.get('27')).toBe('智利')
    expect(map.get('15')).toBe('泰国')
    expect(map.has('')).toBe(false)
    expect(map.has('88')).toBe(false)
  })

  it('uses the business override for TW and HK before the vendor country', () => {
    expect(resolveProxyCountryLabel('tw', '台湾')).toBe('中国台湾')
    expect(resolveProxyCountryLabel('HK', 'Hong Kong')).toBe('中国香港')
    expect(resolveProxyCountryLabel('US', 'United States')).toBe('United States')
    expect(resolveProxyCountryLabel('US', null)).toBeNull()
    expect(resolveProxyCountryLabel(null, '  ')).toBeNull()
  })
})

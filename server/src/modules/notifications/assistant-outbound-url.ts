import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const ALLOWED_HOSTS = new Set(['api.geweapi.com'])
const BLOCKED_IPV4_RANGES: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToNumber(address)
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return (value & mask) === (ipv4ToNumber(base) & mask)
  })
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') {
    return true
  }
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    return isIP(mapped) === 4 ? isBlockedIpv4(mapped) : true
  }
  return normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:')
}

/** 拒绝回环、私网、链路本地、保留与多播地址；用于出站请求前的 DNS 结果校验。 */
export function isBlockedOutboundAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    return isBlockedIpv4(address)
  }
  if (family === 6) {
    return isBlockedIpv6(address)
  }
  return true
}

/**
 * 校验 GeWe 基地址：只允许 HTTPS、固定 host、默认端口、无凭据、无查询与片段。
 * 该函数是纯函数，不做 DNS；DNS 校验由 resolveAssistantHost 完成。
 */
export function assertAllowedAssistantBaseUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw new Error('ASSISTANT_BASE_URL_INVALID')
  }
  if (url.protocol !== 'https:') {
    throw new Error('ASSISTANT_BASE_URL_HTTPS_REQUIRED')
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('ASSISTANT_BASE_URL_HOST_NOT_ALLOWED')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('ASSISTANT_BASE_URL_CREDENTIALS_FORBIDDEN')
  }
  if (url.port !== '' && url.port !== '443') {
    throw new Error('ASSISTANT_BASE_URL_PORT_NOT_ALLOWED')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('ASSISTANT_BASE_URL_QUERY_FORBIDDEN')
  }
  return url
}

export type AssistantLookup = (
  hostname: string,
  options: { readonly all: true },
) => Promise<readonly { readonly address: string, readonly family: number }[]>

/**
 * 解析并校验目标 host 的所有地址；任一地址落在私网/回环/保留段即拒绝。
 * 固定 host 仍然做 DNS 校验，避免解析结果被篡改或 host 配置漂移。
 */
export async function resolveAssistantHost(
  hostname: string,
  lookup: AssistantLookup = dnsLookup,
): Promise<readonly { readonly address: string, readonly family: number }[]> {
  if (!ALLOWED_HOSTS.has(hostname.toLowerCase())) {
    throw new Error('ASSISTANT_BASE_URL_HOST_NOT_ALLOWED')
  }
  const addresses = await lookup(hostname, { all: true })
  if (addresses.length === 0) {
    throw new Error('ASSISTANT_BASE_URL_DNS_EMPTY')
  }
  if (addresses.some(entry => isBlockedOutboundAddress(entry.address))) {
    throw new Error('ASSISTANT_BASE_URL_PRIVATE_ADDRESS')
  }
  return addresses
}

/** 拼接 GeWe API 路径；路径必须是站内固定常量，不接受外部输入的 ../ 或反斜杠。 */
export function buildAssistantApiUrl(baseUrl: string, path: string): URL {
  const base = assertAllowedAssistantBaseUrl(baseUrl)
  if (!path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    throw new Error('ASSISTANT_API_PATH_INVALID')
  }
  return new URL(path, base)
}

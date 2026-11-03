import { ProxyIpType, ProxyProtocol } from '../../generated/prisma/enums'
import type {
  RawIpfoxyAreaRecord,
  RawIpfoxyProxyRecord,
} from './ipfoxy.client'

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u
const COUNTRY_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  TW: '中国台湾',
  HK: '中国香港',
})

export interface NormalizedProxyNode {
  readonly providerProxyId: string
  readonly host: string
  readonly publicIp: string | null
  readonly port: number
  readonly protocol: ProxyProtocol
  readonly countryCode: string | null
  readonly areaId: string | null
  readonly vendorCountry: string | null
  readonly ipType: ProxyIpType
  readonly ipVersion: string
  readonly autoExtend: boolean
  readonly boughtAt: Date | null
  readonly expiresAt: Date
  readonly lastRenewedAt: Date | null
  readonly username: string
  readonly password: string
}

export class ProxyNodeRecordError extends Error {
  constructor(
    readonly providerProxyId: string,
    readonly reason: string,
  ) {
    super(`Invalid IPFoxy proxy record ${providerProxyId}: ${reason}`)
    this.name = 'ProxyNodeRecordError'
  }
}

function readString(
  value: unknown,
  field: string,
  maxLength: number,
  options: { trim?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`)
  }
  const text = options.trim === false ? value : value.trim()
  if (text.length === 0) {
    throw new Error(`${field} must not be empty`)
  }
  if (text.length > maxLength) {
    throw new Error(`${field} is too long`)
  }
  return text
}

function readOptionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  return readString(value, field, maxLength)
}

function readUnixSeconds(
  value: unknown,
  field: string,
  required: boolean,
): Date | null {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error(`${field} is required`)
    }
    return null
  }

  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    if (required) {
      throw new Error(`${field} must be a positive timestamp`)
    }
    return null
  }

  const date = new Date(seconds * 1000)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} is not a valid timestamp`)
  }
  return date
}

function readPort(value: unknown): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('port must be an integer between 1 and 65535')
  }
  return port
}

function readScalarText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function readProtocol(value: unknown): ProxyProtocol {
  const protocol = readScalarText(value).toLowerCase()
  if (protocol === 'socks5') return ProxyProtocol.SOCKS5
  if (protocol === 'http') return ProxyProtocol.HTTP
  if (protocol === 'ssh') return ProxyProtocol.SSH
  throw new Error('protocol is unsupported')
}

function readIpType(value: unknown): ProxyIpType {
  const ipType = readScalarText(value)
  if (ipType === ProxyIpType.STATIC_DATACENTER) return ProxyIpType.STATIC_DATACENTER
  if (ipType === ProxyIpType.STATIC_ISP) return ProxyIpType.STATIC_ISP
  if (ipType === ProxyIpType.STATIC_ISP_PRO) return ProxyIpType.STATIC_ISP_PRO
  throw new Error('ip_type is unsupported')
}

function readCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const code = value.trim().toUpperCase()
  return COUNTRY_CODE_PATTERN.test(code) ? code : null
}

function readBooleanFlag(value: unknown): boolean {
  return readScalarText(value) === '1'
}

export function buildAreaCountryMap(
  areas: readonly RawIpfoxyAreaRecord[],
): Map<string, string> {
  const map = new Map<string, string>()

  for (const area of areas) {
    const rawId = area.id
    const id = typeof rawId === 'string' || typeof rawId === 'number'
      ? String(rawId).trim()
      : ''
    const country = typeof area.country === 'string'
      ? area.country.trim()
      : ''

    if (id !== '' && country !== '' && !map.has(id)) {
      map.set(id, country.slice(0, 64))
    }
  }

  return map
}

/**
 * 把供应商原始记录收敛成可落库的字段。
 *
 * 单条记录不合法时抛出 ProxyNodeRecordError，由同步服务跳过并计数，
 * 不让一条脏数据阻断整批同步。
 */
export function mapIpfoxyProxy(
  record: RawIpfoxyProxyRecord,
  areaCountryById: ReadonlyMap<string, string>,
): NormalizedProxyNode {
  const rawId = typeof record.id === 'string' ? record.id.trim() : ''
  const providerProxyId = PROVIDER_ID_PATTERN.test(rawId) ? rawId : 'unknown'

  try {
    if (!PROVIDER_ID_PATTERN.test(rawId)) {
      throw new Error('id is invalid')
    }

    const areaId = readOptionalString(record.area_id, 'area_id', 32)
    const vendorCountry = areaId === null
      ? null
      : areaCountryById.get(areaId) ?? null

    return {
      providerProxyId,
      host: readString(record.host, 'host', 255),
      publicIp: readOptionalString(record.public_ip, 'public_ip', 64),
      port: readPort(record.port),
      protocol: readProtocol(record.type),
      countryCode: readCountryCode(record.country_code),
      areaId,
      vendorCountry,
      ipType: readIpType(record.ip_type),
      ipVersion: readOptionalString(record.ip_version, 'ip_version', 8) ?? 'IPv4',
      autoExtend: readBooleanFlag(record.auto_extend),
      boughtAt: readUnixSeconds(record.buy_time, 'buy_time', false),
      expiresAt: readUnixSeconds(record.expire_time, 'expire_time', true) as Date,
      lastRenewedAt: readUnixSeconds(record.renewal_time, 'renewal_time', false),
      username: readString(record.user, 'user', 128),
      // 密码不 trim：供应商若允许首尾空白，trim 会直接改变可用凭据。
      password: readString(record.password, 'password', 512, { trim: false }),
    }
  }
  catch (error) {
    throw new ProxyNodeRecordError(
      providerProxyId,
      error instanceof Error ? error.message : 'record is invalid',
    )
  }
}

/**
 * 展示用国家名：TW/HK 固定按业务口径覆盖，其余优先使用 area-list 返回的名称。
 * 名称缺失时返回 null，由前端回退到国家码。
 */
export function resolveProxyCountryLabel(
  countryCode: string | null,
  vendorCountry: string | null,
): string | null {
  const code = countryCode?.trim().toUpperCase() ?? ''
  const override = COUNTRY_OVERRIDES[code]
  if (override) {
    return override
  }

  const country = vendorCountry?.trim()
  return country && country.length > 0 ? country : null
}

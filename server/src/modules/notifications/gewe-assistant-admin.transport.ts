import { lookup as dnsLookup } from 'node:dns/promises'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { AssistantLookup } from './assistant-outbound-url'
import { asRecord, postAssistantJson } from './assistant-http'
import {
  AssistantAdminError,
  ASSISTANT_TRANSPORT_OPTIONS,
  type AssistantAdminTransport,
  type AssistantBriefContact,
} from './notification.types'

interface AssistantAdminTransportOptions {
  readonly fetchImpl?: typeof fetch
  readonly lookup?: AssistantLookup
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

@Injectable()
export class GeweAssistantAdminTransport implements AssistantAdminTransport {
  private readonly fetchImpl: typeof fetch
  private readonly lookup: AssistantLookup

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(ASSISTANT_TRANSPORT_OPTIONS) options: AssistantAdminTransportOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.lookup = options.lookup ?? (async (hostname, lookupOptions) => dnsLookup(hostname, lookupOptions))
  }

  private config(): AssistantConfiguration {
    const config = this.configService.get<AssistantConfiguration>('assistant')
    if (config === undefined) {
      throw new AssistantAdminError('ASSISTANT_TOKEN_MISSING', 'REJECTED', '未配置 ASSISTANT_GEWE_TOKEN')
    }
    return config
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const result = await postAssistantJson(this.config(), path, body, {
      fetchImpl: this.fetchImpl,
      lookup: this.lookup,
    })
    if (!result.ok) {
      throw new AssistantAdminError(result.code, result.kind, result.message)
    }
    return result.data
  }

  async checkOnline(appId: string): Promise<boolean> {
    const data = await this.post('/gewe/v2/api/login/checkOnline', { appId })
    if (typeof data === 'boolean') {
      return data
    }
    const record = asRecord(data)
    if (typeof record?.online === 'boolean') {
      return record.online
    }
    throw new AssistantAdminError('ASSISTANT_ONLINE_RESPONSE_INVALID', 'UNKNOWN', 'GeWe 在线状态响应无效')
  }

  async fetchContactIds(appId: string): Promise<{ readonly friends: readonly string[], readonly chatrooms: readonly string[] }> {
    const data = asRecord(await this.post('/gewe/v2/api/contacts/fetchContactsList', { appId }))
    return {
      friends: asStringList(data?.friends),
      chatrooms: asStringList(data?.chatrooms),
    }
  }

  async fetchBriefInfo(appId: string, wxids: readonly string[]): Promise<readonly AssistantBriefContact[]> {
    const contacts: AssistantBriefContact[] = []
    for (const group of chunk([...new Set(wxids)].slice(0, 100), 20)) {
      if (group.length === 0) {
        continue
      }
      const data = await this.post('/gewe/v2/api/contacts/getBriefInfo', { appId, wxids: group })
      if (!Array.isArray(data)) {
        throw new AssistantAdminError('ASSISTANT_CONTACTS_RESPONSE_INVALID', 'UNKNOWN', 'GeWe 好友信息响应无效')
      }
      for (const item of data) {
        const record = asRecord(item)
        const wxid = asString(record?.userName)
        if (wxid !== null) {
          contacts.push({
            wxid,
            nickname: asString(record?.nickName),
            remark: asString(record?.remark),
            alias: asString(record?.alias),
            avatarUrl: asString(record?.bigHeadImgUrl) ?? asString(record?.smallHeadImgUrl),
          })
        }
      }
    }
    return contacts
  }

  async getOwnQrCode(appId: string): Promise<string> {
    const data = asRecord(await this.post('/gewe/v2/api/personal/getQrCode', { appId }))
    const qrCode = asString(data?.qrCode)
    if (qrCode === null) {
      throw new AssistantAdminError('ASSISTANT_QR_INVALID', 'UNKNOWN', 'GeWe 未返回个人二维码')
    }
    return qrCode
  }

  async checkRelations(appId: string, wxids: readonly string[]): Promise<readonly { readonly wxid: string, readonly relation: number }[]> {
    const results: Array<{ wxid: string, relation: number }> = []
    for (const group of chunk([...new Set(wxids)].slice(0, 100), 20)) {
      if (group.length === 0) {
        continue
      }
      const data = await this.post('/gewe/v2/api/contacts/checkRelation', { appId, wxids: group })
      if (!Array.isArray(data)) {
        throw new AssistantAdminError('ASSISTANT_RELATION_RESPONSE_INVALID', 'UNKNOWN', 'GeWe 好友关系响应无效')
      }
      for (const item of data) {
        const record = asRecord(item)
        const wxid = asString(record?.wxid)
        const relation = Number(record?.relation)
        if (wxid !== null && Number.isInteger(relation)) {
          results.push({ wxid, relation })
        }
      }
    }
    return results
  }
}

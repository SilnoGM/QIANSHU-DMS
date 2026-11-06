import type { AxiosInstance } from 'axios'

import type {
  AssistantAccountCreateDto,
  AssistantAccountDto,
  AssistantAccountQrDto,
  AssistantAccountUpdateDto,
  AssistantBindingCheckDto,
  AssistantBindingCreateDto,
  AssistantBindingDto,
  AssistantBindingPageDto,
  AssistantBindingsListData,
  AssistantChannelDto,
  AssistantChannelUpdateDto,
  AssistantContactDto,
  AssistantTargetDto,
  AssistantTargetUpdateDto,
  AssistantTestSendDto,
  NotificationCancelResultDto,
  NotificationChannelPolicyDto,
  NotificationChannelPolicyUpdateDto,
  NotificationOverviewDto,
  NotificationRecordDetailDto,
  NotificationRecordPageDto,
  NotificationsRecordsListData,
  NotificationTemplateCreateDto,
  NotificationTemplateDto,
  NotificationTemplatePreviewDto,
  NotificationTemplatePreviewResultDto,
  NotificationTemplateUpdateDto,
} from '../generated/types.gen'
import api from '../index'

export type AssistantBindingListQuery = NonNullable<AssistantBindingsListData['query']>
export type NotificationRecordListQuery = NonNullable<NotificationsRecordsListData['query']>

function path(...segments: string[]): string {
  return segments.map(segment => encodeURIComponent(segment)).join('/')
}

/**
 * 通知中心管理 API。读取请求带 signal 与本地错误呈现；写请求禁止自动重试，
 * 避免网络抖动造成重复创建或覆盖较新的 version。
 */
export function createNotificationsApi(client: AxiosInstance) {
  return {
    overview: {
      get: (signal: AbortSignal) =>
        client.get<NotificationOverviewDto>('notifications/overview', { errorPresentation: 'local', signal }),
    },
    templates: {
      list: (channel: string, signal: AbortSignal) =>
        client.get<NotificationTemplateDto[]>('notifications/templates', { errorPresentation: 'local', params: { channel }, signal }),
      create: (input: NotificationTemplateCreateDto) =>
        client.post<NotificationTemplateDto>('notifications/templates', input, { errorPresentation: 'local', retry: false }),
      update: (id: string, input: NotificationTemplateUpdateDto) =>
        client.patch<NotificationTemplateDto>(path('notifications', 'templates', id), input, { errorPresentation: 'local', retry: false }),
      preview: (id: string, input: NotificationTemplatePreviewDto) =>
        client.post<NotificationTemplatePreviewResultDto>(path('notifications', 'templates', id, 'preview'), input, { errorPresentation: 'local', retry: false }),
      test: (id: string, input: NotificationTemplatePreviewDto) =>
        client.post<AssistantTestSendDto>(path('notifications', 'templates', id, 'test'), input, { errorPresentation: 'local', retry: false }),
    },
    policies: {
      list: (query: { eventType?: string, channel?: 'IN_APP' | 'ASSISTANT' }, signal: AbortSignal) =>
        client.get<NotificationChannelPolicyDto[]>('notifications/channel-policies', { errorPresentation: 'local', params: query, signal }),
      update: (eventType: string, channel: 'IN_APP' | 'ASSISTANT', input: NotificationChannelPolicyUpdateDto) =>
        client.put<NotificationChannelPolicyDto>(path('notifications', 'channel-policies', eventType, channel), input, { errorPresentation: 'local', retry: false }),
    },
    records: {
      list: (query: NotificationRecordListQuery, signal: AbortSignal) =>
        client.get<NotificationRecordPageDto>('notifications/records', { errorPresentation: 'local', params: query, signal }),
      get: (id: string, signal: AbortSignal) =>
        client.get<NotificationRecordDetailDto>(path('notifications', 'records', id), { errorPresentation: 'local', signal }),
      cancel: (id: string) =>
        client.post<NotificationCancelResultDto>(path('notifications', 'records', id, 'cancel'), {}, { errorPresentation: 'local', retry: false }),
    },
    assistant: {
      channel: {
        get: (signal: AbortSignal) =>
          client.get<AssistantChannelDto>('assistant/channel', { errorPresentation: 'local', signal }),
        update: (input: AssistantChannelUpdateDto) =>
          client.put<AssistantChannelDto>('assistant/channel', input, { errorPresentation: 'local', retry: false }),
        test: () =>
          client.post<AssistantTestSendDto>('assistant/channel/test', {}, { errorPresentation: 'local', retry: false }),
      },
      accounts: {
        list: (signal: AbortSignal) =>
          client.get<AssistantAccountDto[]>('assistant/accounts', { errorPresentation: 'local', signal }),
        create: (input: AssistantAccountCreateDto) =>
          client.post<AssistantAccountDto>('assistant/accounts', input, { errorPresentation: 'local', retry: false }),
        update: (id: string, input: AssistantAccountUpdateDto) =>
          client.patch<AssistantAccountDto>(path('assistant', 'accounts', id), input, { errorPresentation: 'local', retry: false }),
        checkStatus: (id: string) =>
          client.post<AssistantAccountDto>(path('assistant', 'accounts', id, 'check'), {}, { errorPresentation: 'local', retry: false }),
        qrcode: (id: string, signal: AbortSignal) =>
          client.get<AssistantAccountQrDto>(path('assistant', 'accounts', id, 'qrcode'), { errorPresentation: 'local', signal }),
      },
      contacts: {
        list: (query: string | undefined, signal: AbortSignal) =>
          client.get<AssistantContactDto[]>('assistant/contacts', { errorPresentation: 'local', params: query ? { query } : undefined, signal }),
      },
      bindings: {
        list: (query: AssistantBindingListQuery, signal: AbortSignal) =>
          client.get<AssistantBindingPageDto>('assistant/bindings', { errorPresentation: 'local', params: query, signal }),
        create: (input: AssistantBindingCreateDto) =>
          client.post<AssistantBindingDto>('assistant/bindings', input, { errorPresentation: 'local', retry: false }),
        verify: (id: string) =>
          client.post<AssistantBindingDto>(path('assistant', 'bindings', id, 'verify'), {}, { errorPresentation: 'local', retry: false }),
        remove: (id: string) =>
          client.delete<void>(path('assistant', 'bindings', id), { errorPresentation: 'local', retry: false }),
        check: () =>
          client.post<AssistantBindingCheckDto>('assistant/bindings/check', {}, { errorPresentation: 'local', retry: false }),
      },
      targets: {
        list: (signal: AbortSignal) =>
          client.get<AssistantTargetDto[]>('assistant/targets', { errorPresentation: 'local', signal }),
        sync: () =>
          client.post<AssistantTargetDto[]>('assistant/targets/sync', {}, { errorPresentation: 'local', retry: false }),
        update: (id: string, input: AssistantTargetUpdateDto) =>
          client.patch<AssistantTargetDto>(path('assistant', 'targets', id), input, { errorPresentation: 'local', retry: false }),
      },
    },
  }
}

export default createNotificationsApi(api)

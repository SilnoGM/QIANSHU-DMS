import type { AxiosInstance } from 'axios'

import type {
  NotificationCancelResultDto,
  NotificationChannelPolicyDto,
  NotificationChannelPolicyUpdateDto,
  NotificationEventDto,
  NotificationInboxDetailDto,
  NotificationInboxListData,
  NotificationInboxNewDto,
  NotificationInboxPageDto,
  NotificationInboxReadAllResultDto,
  NotificationInboxUnreadCountDto,
  NotificationOverviewDto,
  NotificationPreferenceListDto,
  NotificationPreferenceUpdateResultDto,
  NotificationRecordDetailDto,
  NotificationRecordOptionsDto,
  NotificationRecordPageDto,
  NotificationsRecordsListData,
  NotificationTemplateCreateDto,
  NotificationTemplateDto,
  NotificationTemplatePreviewDto,
  NotificationTemplatePreviewResultDto,
  NotificationTemplateUpdateDto,
  WecomAppCreateDto,
  WecomAppDto,
  WecomAppSecretUpdateDto,
  WecomAppTestResultDto,
  WecomAppUpdateDto,
  WecomBindingCreateDto,
  WecomBindingDto,
  WecomBindingVerifyDto,
  WecomChannelDto,
  WecomChannelUpdateDto,
  WecomEventRoutesDto,
  WecomEventRoutesUpdateDto,
  WecomMembershipCreateDto,
  WecomMembershipDto,
  WecomTargetCreateDto,
  WecomTargetDto,
  WecomTargetUpdateDto,
  WecomTestResultDto,
} from '../generated/types.gen'
import api from '../index'

export type NotificationRecordListQuery = NonNullable<NotificationsRecordsListData['query']>
export type NotificationInboxDomain = NonNullable<NonNullable<NotificationInboxListData['query']>['domain']>
export type NotificationInboxStatus = 'all' | 'unread' | 'archived'

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
    events: {
      list: (signal: AbortSignal) =>
        client.get<NotificationEventDto[]>('notifications/events', { errorPresentation: 'local', signal }),
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
    },
    policies: {
      list: (query: { eventType?: string, channel?: 'IN_APP' | 'WECOM' }, signal: AbortSignal) =>
        client.get<NotificationChannelPolicyDto[]>('notifications/channel-policies', { errorPresentation: 'local', params: query, signal }),
      update: (eventType: string, channel: 'IN_APP' | 'WECOM', input: NotificationChannelPolicyUpdateDto) =>
        client.put<NotificationChannelPolicyDto>(path('notifications', 'channel-policies', eventType, channel), input, { errorPresentation: 'local', retry: false }),
    },
    records: {
      list: (query: NotificationRecordListQuery, signal: AbortSignal) =>
        client.get<NotificationRecordPageDto>('notifications/records', { errorPresentation: 'local', params: query, signal }),
      get: (id: string, signal: AbortSignal) =>
        client.get<NotificationRecordDetailDto>(path('notifications', 'records', id), { errorPresentation: 'local', signal }),
      options: (signal: AbortSignal) =>
        client.get<NotificationRecordOptionsDto>('notifications/records/options', { errorPresentation: 'local', signal }),
      cancel: (id: string) =>
        client.post<NotificationCancelResultDto>(path('notifications', 'records', id, 'cancel'), {}, { errorPresentation: 'local', retry: false }),
    },
    inbox: {
      list: (query: { status: NotificationInboxStatus, domain?: NotificationInboxDomain, page: number, pageSize: number }, signal: AbortSignal) =>
        client.get<NotificationInboxPageDto>('notifications/me/inbox', { errorPresentation: 'local', params: query, signal }),
      unreadCount: (signal: AbortSignal) =>
        client.get<NotificationInboxUnreadCountDto>('notifications/me/inbox/unread-count', { errorPresentation: 'local', signal }),
      newItems: (cursor: string | undefined, signal: AbortSignal) =>
        client.get<NotificationInboxNewDto>('notifications/me/inbox/new', { errorPresentation: 'local', params: { limit: 20, ...(cursor === undefined ? {} : { cursor }) }, signal }),
      get: (id: string, signal: AbortSignal) =>
        client.get<NotificationInboxDetailDto>(path('notifications', 'me', 'inbox', id), { errorPresentation: 'local', signal }),
      read: (id: string) =>
        client.post<NotificationInboxDetailDto>(path('notifications', 'me', 'inbox', id, 'read'), {}, { errorPresentation: 'local', retry: false }),
      unread: (id: string) =>
        client.post<NotificationInboxDetailDto>(path('notifications', 'me', 'inbox', id, 'unread'), {}, { errorPresentation: 'local', retry: false }),
      readAll: (domain?: NotificationInboxDomain) =>
        client.post<NotificationInboxReadAllResultDto>('notifications/me/inbox/read-all', domain === undefined ? {} : { domain }, { errorPresentation: 'local', retry: false }),
      archive: (id: string) =>
        client.post<NotificationInboxDetailDto>(path('notifications', 'me', 'inbox', id, 'archive'), {}, { errorPresentation: 'local', retry: false }),
      unarchive: (id: string) =>
        client.post<NotificationInboxDetailDto>(path('notifications', 'me', 'inbox', id, 'unarchive'), {}, { errorPresentation: 'local', retry: false }),
    },
    preferences: {
      list: (signal: AbortSignal) =>
        client.get<NotificationPreferenceListDto>('notifications/me/preferences', { errorPresentation: 'local', signal }),
      update: (eventType: string, channel: 'IN_APP' | 'WECOM', muted: boolean) =>
        client.put<NotificationPreferenceUpdateResultDto>(
          path('notifications', 'me', 'preferences', eventType, channel),
          { muted },
          { errorPresentation: 'local', retry: false },
        ),
    },
    wecom: {
      channel: {
        get: (signal: AbortSignal) =>
          client.get<WecomChannelDto>('notifications/wecom/channel', { errorPresentation: 'local', signal }),
        update: (input: WecomChannelUpdateDto) =>
          client.put<WecomChannelDto>('notifications/wecom/channel', input, { errorPresentation: 'local', retry: false }),
      },
      apps: {
        list: (signal: AbortSignal) =>
          client.get<WecomAppDto[]>('notifications/wecom/apps', { errorPresentation: 'local', signal }),
        create: (input: WecomAppCreateDto) =>
          client.post<WecomAppDto>('notifications/wecom/apps', input, { errorPresentation: 'local', retry: false }),
        update: (id: string, input: WecomAppUpdateDto) =>
          client.patch<WecomAppDto>(path('notifications', 'wecom', 'apps', id), input, { errorPresentation: 'local', retry: false }),
        updateSecret: (id: string, input: WecomAppSecretUpdateDto) =>
          client.put<WecomAppDto>(path('notifications', 'wecom', 'apps', id, 'secret'), input, { errorPresentation: 'local', retry: false }),
        test: (id: string) =>
          client.post<WecomAppTestResultDto>(path('notifications', 'wecom', 'apps', id, 'test'), {}, { errorPresentation: 'local', retry: false }),
        events: {
          get: (id: string, signal: AbortSignal) =>
            client.get<WecomEventRoutesDto>(path('notifications', 'wecom', 'apps', id, 'events'), { errorPresentation: 'local', signal }),
          update: (id: string, input: WecomEventRoutesUpdateDto) =>
            client.put<WecomEventRoutesDto>(path('notifications', 'wecom', 'apps', id, 'events'), input, { errorPresentation: 'local', retry: false }),
        },
        members: {
          list: (id: string, signal: AbortSignal) =>
            client.get<WecomMembershipDto[]>(path('notifications', 'wecom', 'apps', id, 'members'), { errorPresentation: 'local', signal }),
          add: (id: string, input: WecomMembershipCreateDto) =>
            client.post<WecomMembershipDto>(path('notifications', 'wecom', 'apps', id, 'members'), input, { errorPresentation: 'local', retry: false }),
          remove: (id: string, userId: string) =>
            client.delete<void>(path('notifications', 'wecom', 'apps', id, 'members', userId), { errorPresentation: 'local', retry: false }),
        },
      },
      bindings: {
        list: (signal: AbortSignal) =>
          client.get<WecomBindingDto[]>('notifications/wecom/bindings', { errorPresentation: 'local', signal }),
        create: (input: WecomBindingCreateDto) =>
          client.post<WecomBindingDto>('notifications/wecom/bindings', input, { errorPresentation: 'local', retry: false }),
        verify: (id: string, input: WecomBindingVerifyDto) =>
          client.post<WecomTestResultDto>(path('notifications', 'wecom', 'bindings', id, 'verify'), input, { errorPresentation: 'local', retry: false }),
        remove: (id: string) =>
          client.delete<void>(path('notifications', 'wecom', 'bindings', id), { errorPresentation: 'local', retry: false }),
      },
      targets: {
        list: (signal: AbortSignal) =>
          client.get<WecomTargetDto[]>('notifications/wecom/targets', { errorPresentation: 'local', signal }),
        create: (input: WecomTargetCreateDto) =>
          client.post<WecomTargetDto>('notifications/wecom/targets', input, { errorPresentation: 'local', retry: false }),
        update: (id: string, input: WecomTargetUpdateDto) =>
          client.patch<WecomTargetDto>(path('notifications', 'wecom', 'targets', id), input, { errorPresentation: 'local', retry: false }),
        remove: (id: string) =>
          client.delete<void>(path('notifications', 'wecom', 'targets', id), { errorPresentation: 'local', retry: false }),
        test: (id: string) =>
          client.post<WecomTestResultDto>(path('notifications', 'wecom', 'targets', id, 'test'), {}, { errorPresentation: 'local', retry: false }),
      },
    },
  }
}

export default createNotificationsApi(api)

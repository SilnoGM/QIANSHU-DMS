import type { NotificationInboxItemDto } from '@/api/generated/types.gen'

import notificationsApi from '@/api/modules/notifications'

/**
 * 顶栏铃铛的站内通知状态。列表只在打开面板时刷新；未读数按 30 秒轮询，
 * 页面隐藏时暂停，恢复可见/聚焦时立即补拉。
 */
export const useAppNotificationStore = defineStore('appNotification', () => {
  const unreadTotal = ref(0)
  const recent = ref<NotificationInboxItemDto[]>([])
  const loading = ref(false)

  let started = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let visibilityListener: (() => void) | null = null
  let focusListener: (() => void) | null = null

  async function refreshUnread(): Promise<void> {
    try {
      unreadTotal.value = (await notificationsApi.inbox.unreadCount(new AbortController().signal)).data.total
    }
    catch {
      // 铃铛轮询失败不弹错，避免打断当前页面；下一次轮询或聚焦会重试。
    }
  }

  async function refreshRecent(): Promise<void> {
    loading.value = true
    try {
      recent.value = (await notificationsApi.inbox.list({
        status: 'all',
        page: 1,
        pageSize: 5,
      }, new AbortController().signal)).data.items
    }
    catch {
      // 面板错误由页面自行处理；铃铛保留上一次成功列表。
    }
    finally {
      loading.value = false
    }
  }

  async function markRead(id: string): Promise<void> {
    await notificationsApi.inbox.read(id)
    const now = new Date().toISOString()
    recent.value = recent.value.map(item => item.id === id ? { ...item, readAt: now } : item)
    await refreshUnread()
  }

  async function readAll(): Promise<void> {
    await notificationsApi.inbox.readAll()
    const now = new Date().toISOString()
    recent.value = recent.value.map(item => item.readAt === null ? { ...item, readAt: now } : item)
    await refreshUnread()
  }

  function schedule(): void {
    if (!started) {
      return
    }
    const jitter = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! % 6_000
    const delay = 30_000 + jitter - 3_000
    timer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        void refreshUnread()
      }
      schedule()
    }, delay)
  }

  function startPolling(): void {
    if (started) {
      return
    }
    started = true
    void refreshUnread()
    visibilityListener = () => {
      if (document.visibilityState === 'visible') {
        void refreshUnread()
      }
    }
    focusListener = () => {
      void refreshUnread()
    }
    document.addEventListener('visibilitychange', visibilityListener)
    window.addEventListener('focus', focusListener)
    schedule()
  }

  function stopPolling(): void {
    started = false
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (visibilityListener !== null) {
      document.removeEventListener('visibilitychange', visibilityListener)
      visibilityListener = null
    }
    if (focusListener !== null) {
      window.removeEventListener('focus', focusListener)
      focusListener = null
    }
  }

  return {
    unreadTotal,
    recent,
    loading,
    refreshUnread,
    refreshRecent,
    markRead,
    readAll,
    startPolling,
    stopPolling,
  }
})

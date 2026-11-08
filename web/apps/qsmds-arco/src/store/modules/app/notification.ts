import type { NotificationInboxItemDto, NotificationInboxNewItemDto } from '@/api/generated/types.gen'

import notificationsApi from '@/api/modules/notifications'
import {
  collectNotificationPages,
  desktopRetryDelay,
  shouldYieldLeadership,
  unreadPollDelay,
  unreadRetryDelay,
} from './notification-polling'

const CHANNEL_NAME = 'qianshu-notification-inbox'
const DESKTOP_PREFERENCE_PREFIX = 'qianshu.notification.desktop.'
const DESKTOP_SEEN_LIMIT = 200
const RECENT_NOTIFICATION_LIMIT = 10

interface LockManagerLike {
  request: (
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<void>,
  ) => Promise<void>
}

type InboxChannelMessage = {
  readonly type: 'unread'
  readonly total: number
} | {
  readonly type: 'refresh'
} | {
  readonly type: 'desktop'
  readonly enabled: boolean
}

function isUnauthorized(failure: unknown): boolean {
  return typeof failure === 'object'
    && failure !== null
    && 'kind' in failure
    && (failure as { kind?: string }).kind === 'http'
    && (failure as { status?: number }).status === 401
}

function desktopPreferenceKey(userId: string): string {
  return `${DESKTOP_PREFERENCE_PREFIX}${userId}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 顶栏铃铛的站内通知状态。未读数与桌面通知由 Web Locks 选出的主标签轮询，
 * 其他标签通过 BroadcastChannel 接收总数；页面隐藏时暂停，聚焦时补拉。
 */
export const useAppNotificationStore = defineStore('appNotification', () => {
  const unreadTotal = ref(0)
  const recent = ref<NotificationInboxItemDto[]>([])
  const loading = ref(false)
  const isLeader = ref(false)
  const desktopEnabled = ref(false)
  const desktopSupported = ref(false)
  const desktopPermission = ref<NotificationPermission>('default')

  let started = false
  let leader = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let channel: BroadcastChannel | null = null
  let releaseLeader: (() => void) | null = null
  let visibilityListener: (() => void) | null = null
  let focusListener: (() => void) | null = null
  let leadershipPending = false
  let unreadFailureCount = 0
  let unreadRequest: Promise<void> | null = null
  let unreadRequestToken: object | null = null
  let unreadAbortController: AbortController | null = null

  let desktopUserId = ''
  let desktopTimer: ReturnType<typeof setTimeout> | null = null
  let desktopRetryTimer: ReturnType<typeof setTimeout> | null = null
  let desktopPolling = false
  let desktopCursor: string | undefined
  let desktopInitialized = false
  let desktopFailureCount = 0
  let desktopAbortController: AbortController | null = null
  const desktopSeen = new Set<string>()
  const desktopNotifications: Notification[] = []

  function broadcast(message: InboxChannelMessage): void {
    channel?.postMessage(message)
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function closeDesktopNotifications(): void {
    for (const notification of desktopNotifications) {
      notification.close()
    }
    desktopNotifications.length = 0
  }

  function rememberDesktopSeen(id: string): void {
    desktopSeen.add(id)
    while (desktopSeen.size > DESKTOP_SEEN_LIMIT) {
      const first = desktopSeen.values().next().value
      if (first === undefined) {
        break
      }
      desktopSeen.delete(first)
    }
  }

  /**
   * 未读数只保留一个在途请求。成功清零失败计数，失败按退避递增；
   * stopPolling 会 abort 当前请求并阻止迟到响应改动已退出会话的状态。
   */
  function fetchUnread(): Promise<void> {
    if (unreadRequest !== null) {
      return unreadRequest
    }
    const controller = new AbortController()
    const token = {}
    unreadAbortController = controller
    unreadRequestToken = token
    const request = (async () => {
      try {
        const total = (await notificationsApi.inbox.unreadCount(controller.signal)).data.total
        if (controller.signal.aborted || !started) {
          return
        }
        const changed = total !== unreadTotal.value
        unreadTotal.value = total
        unreadFailureCount = 0
        if (leader && changed) {
          broadcast({ type: 'unread', total })
        }
      }
      catch (failure) {
        if (controller.signal.aborted || !started) {
          return
        }
        if (isUnauthorized(failure)) {
          stopPolling()
          return
        }
        unreadFailureCount += 1
      }
      finally {
        if (unreadAbortController === controller) {
          unreadAbortController = null
        }
        if (unreadRequestToken === token) {
          unreadRequestToken = null
          unreadRequest = null
        }
      }
    })()
    unreadRequest = request
    return request
  }

  async function refreshUnread(): Promise<void> {
    if (leader) {
      await fetchUnread()
      schedule()
      return
    }
    if (channel !== null) {
      broadcast({ type: 'refresh' })
      return
    }
    await fetchUnread()
  }

  async function refreshRecent(): Promise<void> {
    loading.value = true
    try {
      recent.value = (await notificationsApi.inbox.list({
        status: 'all',
        page: 1,
        pageSize: RECENT_NOTIFICATION_LIMIT,
      }, new AbortController().signal)).data.items
    }
    catch (failure) {
      if (isUnauthorized(failure)) {
        stopPolling()
      }
    }
    finally {
      loading.value = false
    }
  }

  async function markRead(id: string): Promise<void> {
    try {
      await notificationsApi.inbox.read(id)
      const now = new Date().toISOString()
      recent.value = recent.value.map(item => item.id === id ? { ...item, readAt: now } : item)
      await refreshUnread()
    }
    catch (failure) {
      if (isUnauthorized(failure)) {
        stopPolling()
      }
      throw failure
    }
  }

  async function readAll(): Promise<void> {
    try {
      await notificationsApi.inbox.readAll()
      const now = new Date().toISOString()
      recent.value = recent.value.map(item => item.readAt === null ? { ...item, readAt: now } : item)
      await refreshUnread()
    }
    catch (failure) {
      if (isUnauthorized(failure)) {
        stopPolling()
      }
      throw failure
    }
  }

  function schedule(): void {
    if (!started || !leader) {
      return
    }
    clearTimer()
    const delay = unreadFailureCount === 0
      ? unreadPollDelay(globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!)
      : unreadRetryDelay(unreadFailureCount)
    timer = setTimeout(() => {
      void pollUnread()
    }, delay)
  }

  async function pollUnread(): Promise<void> {
    if (!started || !leader) {
      return
    }
    if (document.visibilityState === 'visible') {
      await fetchUnread()
    }
    schedule()
  }

  function becomeLeader(): void {
    if (!started) {
      return
    }
    leader = true
    isLeader.value = true
    void fetchUnread().finally(() => {
      if (leader) {
        schedule()
      }
    })
    if (desktopEnabled.value) {
      void startDesktopPolling()
    }
  }

  function resignLeader(): void {
    leader = false
    isLeader.value = false
    clearTimer()
    stopDesktopPolling()
  }

  function yieldLeadership(): void {
    if (!leader) {
      return
    }
    const release = releaseLeader
    releaseLeader = null
    resignLeader()
    release?.()
  }

  function acquireLeadership(): void {
    if (!started || leader || leadershipPending) {
      return
    }
    const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks
    if (locks === undefined) {
      becomeLeader()
      return
    }
    leadershipPending = true
    void locks.request(CHANNEL_NAME, { mode: 'exclusive' }, async () => {
      if (!started) {
        return
      }
      becomeLeader()
      await new Promise<void>((resolve) => {
        releaseLeader = resolve
      })
      resignLeader()
    }).catch(() => {
      if (started) {
        becomeLeader()
      }
    }).finally(() => {
      leadershipPending = false
    })
  }

  function handleChannelMessage(event: MessageEvent<unknown>): void {
    const data = event.data
    if (typeof data !== 'object' || data === null || !('type' in data)) {
      return
    }
    if (data.type === 'unread' && 'total' in data && typeof data.total === 'number') {
      unreadTotal.value = data.total
      return
    }
    if (data.type === 'refresh' && leader) {
      void fetchUnread()
      return
    }
    if (data.type === 'desktop' && 'enabled' in data && typeof data.enabled === 'boolean') {
      desktopEnabled.value = data.enabled
      if (!data.enabled) {
        stopDesktopPolling()
        closeDesktopNotifications()
        if (shouldYieldLeadership(document.visibilityState, desktopEnabled.value)) {
          yieldLeadership()
        }
      }
      else {
        void startDesktopPolling()
      }
    }
  }

  function desktopStorageEnabled(): boolean {
    if (desktopUserId.length === 0) {
      return false
    }
    try {
      return localStorage.getItem(desktopPreferenceKey(desktopUserId)) === '1'
    }
    catch {
      return false
    }
  }

  function persistDesktop(enabled: boolean): void {
    if (desktopUserId.length === 0) {
      return
    }
    try {
      localStorage.setItem(desktopPreferenceKey(desktopUserId), enabled ? '1' : '0')
    }
    catch {
      // 浏览器禁用存储时只影响下次进入页面是否自动开启，不影响当前会话。
    }
  }

  function initDesktop(userId: string): void {
    desktopUserId = userId
    desktopSupported.value = typeof window !== 'undefined'
      && 'Notification' in window
      && window.matchMedia('(min-width: 768px)').matches
    if (!desktopSupported.value || userId.length === 0) {
      desktopEnabled.value = false
      desktopPermission.value = 'default'
      stopDesktopPolling()
      closeDesktopNotifications()
      if (shouldYieldLeadership(document.visibilityState, desktopEnabled.value)) {
        yieldLeadership()
      }
      return
    }
    desktopPermission.value = Notification.permission
    desktopEnabled.value = desktopPermission.value === 'granted' && desktopStorageEnabled()
    if (desktopEnabled.value) {
      void startDesktopPolling()
    }
    else {
      stopDesktopPolling()
      if (shouldYieldLeadership(document.visibilityState, desktopEnabled.value)) {
        yieldLeadership()
      }
    }
  }

  async function setDesktopEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      desktopEnabled.value = false
      persistDesktop(false)
      broadcast({ type: 'desktop', enabled: false })
      stopDesktopPolling()
      closeDesktopNotifications()
      if (shouldYieldLeadership(document.visibilityState, desktopEnabled.value)) {
        yieldLeadership()
      }
      return true
    }
    if (!desktopSupported.value) {
      return false
    }
    try {
      if (Notification.permission === 'default') {
        await Notification.requestPermission()
      }
      desktopPermission.value = Notification.permission
      if (desktopPermission.value !== 'granted') {
        desktopEnabled.value = false
        persistDesktop(false)
        return false
      }
      desktopEnabled.value = true
      persistDesktop(true)
      broadcast({ type: 'desktop', enabled: true })
      showDesktopTest()
      await startDesktopPolling()
      return true
    }
    catch {
      desktopEnabled.value = false
      persistDesktop(false)
      return false
    }
  }

  function showDesktopTest(): void {
    try {
      const notification = new Notification('通知中心', {
        body: '桌面通知已开启，仅在本浏览器页面打开时提醒。',
        tag: 'qianshu-desktop-test',
      })
      desktopNotifications.push(notification)
    }
    catch {
      // 浏览器拒绝创建时保持开关状态，后续新消息仍会尝试。
    }
  }

  function showDesktopItem(item: NotificationInboxNewItemDto): void {
    try {
      const notification = new Notification(item.title, {
        body: item.body,
        tag: `qianshu-inbox-${item.id}`,
      })
      notification.onclick = () => {
        window.focus()
        notification.close()
        window.location.hash = item.linkUrl?.startsWith('/')
          ? `#${item.linkUrl}`
          : `#/notifications?id=${encodeURIComponent(item.id)}`
      }
      desktopNotifications.push(notification)
      while (desktopNotifications.length > 20) {
        desktopNotifications.shift()?.close()
      }
    }
    catch {
      // 权限或系统通知服务异常不阻断通知列表本身。
    }
  }

  function clearDesktopTimer(): void {
    if (desktopTimer !== null) {
      clearTimeout(desktopTimer)
      desktopTimer = null
    }
  }

  function clearDesktopRetry(): void {
    if (desktopRetryTimer !== null) {
      clearTimeout(desktopRetryTimer)
      desktopRetryTimer = null
    }
  }

  function scheduleDesktopRetry(): void {
    if (!desktopEnabled.value || !desktopSupported.value || !leader) {
      return
    }
    clearDesktopRetry()
    desktopRetryTimer = setTimeout(() => {
      desktopRetryTimer = null
      void startDesktopPolling()
    }, desktopRetryDelay(desktopFailureCount))
  }

  function scheduleDesktop(): void {
    if (!desktopEnabled.value || !desktopPolling || !leader) {
      return
    }
    clearDesktopTimer()
    const delay = desktopFailureCount === 0
      ? unreadPollDelay(globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!)
      : desktopRetryDelay(desktopFailureCount)
    desktopTimer = setTimeout(() => {
      void runDesktopPoll()
    }, delay)
  }

  async function runDesktopPoll(): Promise<void> {
    await pollDesktop()
    scheduleDesktop()
  }

  async function startDesktopPolling(): Promise<void> {
    clearDesktopRetry()
    if (!desktopEnabled.value || !desktopSupported.value || desktopPermission.value !== 'granted' || !leader || desktopPolling) {
      return
    }
    desktopPolling = true
    if (!desktopInitialized) {
      const controller = new AbortController()
      desktopAbortController = controller
      try {
        const first = await notificationsApi.inbox.newItems(undefined, controller.signal)
        if (controller.signal.aborted || !desktopPolling) {
          return
        }
        desktopCursor = first.data.nextCursor
        desktopInitialized = true
        desktopFailureCount = 0
      }
      catch (failure) {
        if (controller.signal.aborted) {
          return
        }
        desktopPolling = false
        if (isUnauthorized(failure)) {
          stopPolling()
          return
        }
        desktopFailureCount += 1
        scheduleDesktopRetry()
        return
      }
      finally {
        if (desktopAbortController === controller) {
          desktopAbortController = null
        }
      }
    }
    scheduleDesktop()
  }

  function stopDesktopPolling(): void {
    desktopPolling = false
    desktopInitialized = false
    desktopCursor = undefined
    desktopFailureCount = 0
    desktopAbortController?.abort()
    desktopAbortController = null
    clearDesktopTimer()
    clearDesktopRetry()
  }

  async function pollDesktop(): Promise<void> {
    if (!desktopEnabled.value || !desktopPolling || !leader || desktopCursor === undefined) {
      return
    }
    const controller = new AbortController()
    desktopAbortController = controller
    try {
      const result = await collectNotificationPages(
        desktopCursor,
        cursor => notificationsApi.inbox.newItems(cursor, controller.signal).then(response => response.data),
      )
      if (controller.signal.aborted || !desktopPolling || !leader) {
        return
      }
      desktopCursor = result.cursor
      desktopFailureCount = 0
      unreadTotal.value = result.unreadTotal
      broadcast({ type: 'unread', total: unreadTotal.value })
      const hidden = document.visibilityState === 'hidden' || !document.hasFocus()
      for (const item of result.items) {
        if (desktopSeen.has(item.id)) {
          continue
        }
        rememberDesktopSeen(item.id)
        if (!hidden) {
          continue
        }
        showDesktopItem(item)
        await sleep(200)
      }
    }
    catch (failure) {
      if (controller.signal.aborted) {
        return
      }
      if (isUnauthorized(failure)) {
        stopPolling()
        return
      }
      desktopFailureCount += 1
    }
    finally {
      if (desktopAbortController === controller) {
        desktopAbortController = null
      }
    }
  }

  function startPolling(): void {
    if (started) {
      return
    }
    started = true
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.addEventListener('message', handleChannelMessage)
    }
    visibilityListener = () => {
      if (document.visibilityState === 'visible') {
        unreadFailureCount = 0
        if (!leader) {
          acquireLeadership()
        }
        void refreshUnread()
        if (desktopEnabled.value) {
          void startDesktopPolling()
        }
        return
      }
      if (shouldYieldLeadership(document.visibilityState, desktopEnabled.value)) {
        yieldLeadership()
      }
    }
    focusListener = () => {
      unreadFailureCount = 0
      if (!leader) {
        acquireLeadership()
      }
      void refreshUnread()
      if (desktopEnabled.value) {
        void startDesktopPolling()
      }
    }
    document.addEventListener('visibilitychange', visibilityListener)
    window.addEventListener('focus', focusListener)
    acquireLeadership()
  }

  function stopPolling(): void {
    started = false
    leader = false
    isLeader.value = false
    unreadFailureCount = 0
    unreadAbortController?.abort()
    unreadAbortController = null
    unreadRequest = null
    unreadRequestToken = null
    clearTimer()
    stopDesktopPolling()
    closeDesktopNotifications()
    releaseLeader?.()
    releaseLeader = null
    if (visibilityListener !== null) {
      document.removeEventListener('visibilitychange', visibilityListener)
      visibilityListener = null
    }
    if (focusListener !== null) {
      window.removeEventListener('focus', focusListener)
      focusListener = null
    }
    if (channel !== null) {
      channel.removeEventListener('message', handleChannelMessage)
      channel.close()
      channel = null
    }
    unreadTotal.value = 0
    recent.value = []
  }

  watch(isLeader, (value) => {
    if (!value) {
      stopDesktopPolling()
    }
    else if (desktopEnabled.value) {
      void startDesktopPolling()
    }
  })

  return {
    unreadTotal,
    recent,
    loading,
    isLeader,
    desktopEnabled,
    desktopSupported,
    desktopPermission,
    initDesktop,
    setDesktopEnabled,
    refreshUnread,
    refreshRecent,
    markRead,
    readAll,
    startPolling,
    stopPolling,
  }
})

import proxyNodesApi from '@/api/modules/proxy-nodes'
import { proxyNodeBadgeCounts } from '@/store/modules/app/proxy-node-badge-counts'

/**
 * 静态节点菜单徽章计数。
 *
 * 只调用计数接口，不拉取节点详情，避免为了菜单徽章把代理凭证带到全局。
 * 0 由 FaBadge 自动隐藏；读取失败保留上一次成功值，不打断页面。
 */
export const useProxyNodeBadgeStore = defineStore('proxyNodeBadge', () => {
  const { auth } = useAppAuth()
  let mineController: AbortController | null = null
  let allController: AbortController | null = null

  async function refreshMine(): Promise<void> {
    if (!auth('proxy-nodes:read')) {
      proxyNodeBadgeCounts.mine.value = 0
      return
    }

    mineController?.abort()
    const request = new AbortController()
    mineController = request

    try {
      const response = await proxyNodesApi.expirySummaryMine(request.signal)
      if (!request.signal.aborted) {
        proxyNodeBadgeCounts.mine.value = response.data.expiring2d
      }
    }
    catch {
      // 徽章是降级信息，读取失败保留上一次成功值。
    }
  }

  async function refreshAll(): Promise<void> {
    if (!auth('proxy-nodes:manage')) {
      proxyNodeBadgeCounts.all.value = 0
      return
    }

    allController?.abort()
    const request = new AbortController()
    allController = request

    try {
      const response = await proxyNodesApi.expirySummary(request.signal)
      if (!request.signal.aborted) {
        proxyNodeBadgeCounts.all.value = response.data.expiring2d
      }
    }
    catch {
      // 徽章是降级信息，读取失败保留上一次成功值。
    }
  }

  async function refresh(): Promise<void> {
    await Promise.allSettled([refreshMine(), refreshAll()])
  }

  return {
    myExpiring2d: proxyNodeBadgeCounts.mine,
    allExpiring2d: proxyNodeBadgeCounts.all,
    refreshMine,
    refreshAll,
    refresh,
  }
})

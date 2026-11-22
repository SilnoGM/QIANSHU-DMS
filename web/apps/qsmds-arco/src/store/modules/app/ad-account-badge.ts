import adAccountsApi from '@/api/modules/ad-accounts'
import { adAccountBadgeCounts } from '@/store/modules/app/ad-account-badge-counts'

/**
 * 广告账户「余额预警」菜单徽章计数。
 *
 * 只调用计数接口，不拉取账户明细，避免为了菜单徽章把余额等财务数据带到全局。
 * 0 由 FaBadge 自动隐藏；读取失败保留上一次成功值，不打断页面。
 */
export const useAdAccountBadgeStore = defineStore('adAccountBadge', () => {
  const { auth } = useAppAuth()
  let mineController: AbortController | null = null
  let allController: AbortController | null = null

  async function refreshMine(): Promise<void> {
    if (!auth('ad-accounts:read')) {
      adAccountBadgeCounts.mine.value = 0
      return
    }

    mineController?.abort()
    const request = new AbortController()
    mineController = request

    try {
      const response = await adAccountsApi.alertSummaryMine(request.signal)
      if (!request.signal.aborted) {
        adAccountBadgeCounts.mine.value = response.data.mine
      }
    }
    catch {
      // 徽章是降级信息，读取失败保留上一次成功值。
    }
  }

  async function refreshAll(): Promise<void> {
    if (!auth('ad-accounts:manage')) {
      adAccountBadgeCounts.all.value = 0
      return
    }

    allController?.abort()
    const request = new AbortController()
    allController = request

    try {
      const response = await adAccountsApi.alertSummary(request.signal)
      if (!request.signal.aborted) {
        adAccountBadgeCounts.all.value = response.data.all
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
    myLowBalance: adAccountBadgeCounts.mine,
    allLowBalance: adAccountBadgeCounts.all,
    refreshMine,
    refreshAll,
    refresh,
  }
})

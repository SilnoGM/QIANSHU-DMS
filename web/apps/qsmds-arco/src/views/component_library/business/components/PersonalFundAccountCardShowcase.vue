<script setup lang="ts">
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { QsPersonalFundAccountCardAccount } from '@/components/business/QsPersonalFundAccountCard/types'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsPersonalFundAccountCard from '@/components/business/QsPersonalFundAccountCard/index.vue'

defineOptions({ name: 'PersonalFundAccountCardShowcase' })

const { t } = useI18n()
const toast = useQsToast()

/** 组件库示例使用本地币种描述符，不读取货币目录接口。 */
const currencies: readonly CurrencyDescriptor[] = [
  { code: 'CNY', enabled: true, minorUnit: 2, name: '人民币', symbol: '¥' },
]

const account: QsPersonalFundAccountCardAccount = {
  id: '8f3a7c24-1b6d-4e2a-9c58-7d0e4b2a6f19',
  currency: 'CNY',
  balance: '1170.00',
  userShareRate: '30.00',
  shareRateUpdatedAt: '2026-09-28T01:30:00.000Z',
  createdAt: '2026-03-12T08:00:00.000Z',
  updatedAt: '2026-10-16T09:12:05.000Z',
}

const wideVisible = ref(true)
const narrowVisible = ref(false)
const mobileVisible = ref(true)

function applyWithdrawal(): void {
  toast.info(t('qsPersonalFundAccount.withdrawalComingSoon'))
}

function viewWithdrawals(): void {
  toast.info(t('qsPersonalFundAccount.withdrawalRecordsComingSoon'))
}

function retry(): void {
  toast.info('已触发重试事件（示例）')
}
</script>

<template>
  <section
    aria-labelledby="personal-fund-account-card-showcase-title"
    data-testid="personal-fund-account-card-showcase"
  >
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:wallet" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">账户概览</span>
          </div>
          <h3
            id="personal-fund-account-card-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            个人资金账户卡片场景
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            本地 mock 数据覆盖宽屏、窄屏、移动端、金额隐藏、空态与加载/错误态。
            组件库容器较窄时，宽屏示例可横向滚动查看；按钮只触发轻提示，不跳转、不调接口。
          </p>
        </div>
        <FaTag variant="secondary">
          QsPersonalFundAccountCard
        </FaTag>
      </div>

      <div class="mt-7 space-y-8">
        <div>
          <div class="mb-3 flex flex-wrap gap-2 items-baseline justify-between">
            <span class="qs-type-compact-label text-foreground">宽屏（容器 ≥ 1140px）</span>
            <span class="text-xs text-muted-foreground">三指标横排 + 按钮下方并排</span>
          </div>
          <div class="pb-1 overflow-x-auto">
            <div class="w-[1400px]">
              <QsPersonalFundAccountCard
                v-model:amount-visible="wideVisible"
                :account="account"
                :currencies="currencies"
                @apply-withdrawal="applyWithdrawal"
                @view-withdrawals="viewWithdrawals"
                @retry="retry"
              />
            </div>
          </div>
        </div>

        <div>
          <div class="mb-3 flex flex-wrap gap-2 items-baseline justify-between">
            <span class="qs-type-compact-label text-foreground">窄屏（容器 840–1139px，金额隐藏）</span>
            <span class="text-xs text-muted-foreground">仅日期 + 按钮并排</span>
          </div>
          <div class="pb-1 overflow-x-auto">
            <div class="w-[960px]">
              <QsPersonalFundAccountCard
                v-model:amount-visible="narrowVisible"
                :account="account"
                :currencies="currencies"
                @apply-withdrawal="applyWithdrawal"
                @view-withdrawals="viewWithdrawals"
                @retry="retry"
              />
            </div>
          </div>
        </div>

        <div>
          <div class="mb-3 flex flex-wrap gap-2 items-baseline justify-between">
            <span class="qs-type-compact-label text-foreground">移动端（容器 &lt; 840px）</span>
            <span class="text-xs text-muted-foreground">余额面板置顶 + 指标单列 + 按钮纵向</span>
          </div>
          <div class="max-w-[420px]">
            <QsPersonalFundAccountCard
              v-model:amount-visible="mobileVisible"
              :account="account"
              :currencies="currencies"
              @apply-withdrawal="applyWithdrawal"
              @view-withdrawals="viewWithdrawals"
              @retry="retry"
            />
          </div>
        </div>

        <div>
          <div class="mb-3 flex flex-wrap gap-2 items-baseline justify-between">
            <span class="qs-type-compact-label text-foreground">状态</span>
            <span class="text-xs text-muted-foreground">空态 / 加载 / 失败</span>
          </div>
          <div class="gap-6 grid min-w-0 lg:grid-cols-2">
            <div class="min-w-0">
              <div class="text-xs text-muted-foreground mb-3">
                未开户：红色空态，不显示绿色余额面板与操作按钮
              </div>
              <QsPersonalFundAccountCard
                :account="null"
                :currencies="currencies"
              />
            </div>
            <div class="min-w-0">
              <div class="text-xs text-muted-foreground mb-3">
                加载中：与正式布局同构的骨架
              </div>
              <QsPersonalFundAccountCard
                :account="null"
                :currencies="currencies"
                loading
              />
            </div>
            <div class="min-w-0 lg:col-span-2">
              <div class="text-xs text-muted-foreground mb-3">
                加载失败：不显示 0 余额，提供重试事件
              </div>
              <QsPersonalFundAccountCard
                :account="null"
                :currencies="currencies"
                error="网络异常，请稍后重试"
                @retry="retry"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

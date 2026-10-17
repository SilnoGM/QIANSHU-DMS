<script setup lang="ts">
import type { QsPersonalFundAccountCardAccount } from './types'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { findCurrencyDescriptor } from '@/components/base/currency'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import {
  formatMaskedAmount,
  formatUserShareRate,
  resolvePersonalFundAccountCardState,
  resolvePersonalFundAccountPanelTone,
} from './logic'

/**
 * 运营个人资金账户概览卡片。
 *
 * 纯展示组件：账户数据、加载/错误状态与权限由页面给出，按钮只发事件；
 * 组件不读 API、Store 或路由。布局以自身宽度（容器查询）为准，
 * 因为页面侧边栏会让卡片宽度与视口宽度脱钩。
 */
defineOptions({ name: 'QsPersonalFundAccountCard' })

const props = withDefaults(defineProps<{
  account: QsPersonalFundAccountCardAccount | null
  currencies: readonly CurrencyDescriptor[]
  loading?: boolean
  error?: string | null
}>(), {
  loading: false,
  error: null,
})

const emit = defineEmits<{
  applyWithdrawal: []
  viewWithdrawals: []
  retry: []
}>()

/** 金额可见性默认可见，组件不持久化；页面有需要时可绑定 v-model 自行保存。 */
const amountVisible = defineModel<boolean>('amountVisible', { default: true })

const { t } = useI18n()

const state = computed(() => resolvePersonalFundAccountCardState({
  loading: props.loading,
  error: props.error,
  hasAccount: props.account !== null,
}))

/**
 * 余额面板配色：未开户红色、可见负余额黄色、其余绿色。
 * 金额隐藏时保持绿色，避免颜色反向暴露余额正负。
 */
const panelTone = computed(() => resolvePersonalFundAccountPanelTone({
  state: state.value,
  balance: props.account?.balance ?? null,
  amountVisible: amountVisible.value,
}))

const currencySymbol = computed(() => (
  props.account
    ? findCurrencyDescriptor(props.currencies, props.account.currency)?.symbol ?? ''
    : ''
))
const shareRateText = computed(() => formatUserShareRate(props.account?.userShareRate))
const maskedAmount = computed(() => formatMaskedAmount(currencySymbol.value))
const balanceLabel = computed(() => t('qsPersonalFundAccount.balanceLabel', {
  currency: props.account?.currency ?? 'CNY',
}))
const toggleLabel = computed(() => t(
  amountVisible.value
    ? 'qsPersonalFundAccount.hideAmount'
    : 'qsPersonalFundAccount.showAmount',
))
</script>

<template>
  <FaCard
    role="region"
    :aria-label="t('qsPersonalFundAccount.ariaLabel')"
    :aria-busy="state === 'loading'"
    class="qs-personal-fund-card py-0 rounded-2xl gap-0 overflow-hidden"
    content-class="p-0"
    data-slot="qs-personal-fund-account-card"
  >
    <!-- 加载态：保持与正式布局相同的骨架，避免数据到达时发生整卡跳动。 -->
    <div
      v-if="state === 'loading'"
      class="qs-personal-fund-card__layout"
      role="status"
      :aria-label="t('qsPersonalFundAccount.loading')"
    >
      <section class="qs-personal-fund-card__balance" aria-hidden="true">
        <span class="qs-personal-fund-card__circle qs-personal-fund-card__circle--top" />
        <span class="qs-personal-fund-card__circle qs-personal-fund-card__circle--bottom" />
        <div class="qs-personal-fund-card__balance-content">
          <div class="flex gap-3 items-center">
            <span class="rounded-lg bg-primary-foreground/15 shrink-0 size-10 motion-safe:animate-pulse" />
            <span class="rounded bg-primary-foreground/20 h-5 w-28 motion-safe:animate-pulse" />
          </div>
          <div class="mt-auto flex flex-col gap-3">
            <span class="rounded bg-primary-foreground/20 h-3 w-24 motion-safe:animate-pulse" />
            <span class="rounded bg-primary-foreground/20 h-11 w-2/3 motion-safe:animate-pulse" />
          </div>
        </div>
      </section>

      <div class="qs-personal-fund-card__content" aria-hidden="true">
        <dl class="qs-personal-fund-card__metrics">
          <div
            v-for="index in 3"
            :key="index"
            class="qs-personal-fund-card__metric"
          >
            <span class="rounded-lg bg-muted shrink-0 size-10 motion-safe:animate-pulse" />
            <div class="flex flex-col gap-2 min-w-0 w-full">
              <span class="rounded bg-muted h-3 w-20 motion-safe:animate-pulse" />
              <span class="rounded bg-muted h-5 w-28 motion-safe:animate-pulse" />
              <span class="rounded bg-muted h-3 max-w-full w-32 motion-safe:animate-pulse" />
            </div>
          </div>
        </dl>
        <div class="qs-personal-fund-card__actions">
          <span class="rounded-md bg-muted h-11 w-full motion-safe:animate-pulse" />
          <span class="rounded-md bg-muted h-11 w-full motion-safe:animate-pulse" />
        </div>
      </div>
    </div>

    <!-- 失败态：不显示 0 余额，避免把加载失败误读成账户余额。 -->
    <FaEmpty
      v-else-if="state === 'error'"
      icon="i-lucide:circle-alert"
      :title="t('qsPersonalFundAccount.loadError')"
      :description="error ?? undefined"
      class="p-8"
    >
      <FaButton variant="outline" @click="emit('retry')">
        {{ t('qsPersonalFundAccount.retry') }}
      </FaButton>
    </FaEmpty>

    <div v-else-if="state === 'empty' || account" class="qs-personal-fund-card__layout">
      <section
        class="qs-personal-fund-card__balance"
        :class="{
          'qs-personal-fund-card__balance--yellow': panelTone === 'yellow',
          'qs-personal-fund-card__balance--red': panelTone === 'red',
        }"
      >
        <span class="qs-personal-fund-card__circle qs-personal-fund-card__circle--top" aria-hidden="true" />
        <span class="qs-personal-fund-card__circle qs-personal-fund-card__circle--bottom" aria-hidden="true" />

        <div class="qs-personal-fund-card__balance-content">
          <div class="flex gap-3 items-center">
            <span class="qs-personal-fund-card__title-icon rounded-lg flex-center size-10" aria-hidden="true">
              <FaIcon name="i-lucide:wallet" class="size-5" />
            </span>
            <h2 class="qs-personal-fund-card__title m-0">
              {{ t('qsPersonalFundAccount.title') }}
            </h2>
          </div>

          <div class="mt-auto">
            <div class="flex gap-1 items-center">
              <p class="qs-personal-fund-card__balance-label m-0">
                {{ balanceLabel }}
              </p>
              <FaButton
                v-if="account"
                variant="ghost"
                size="icon-sm"
                class="qs-personal-fund-card__visibility-toggle -my-1"
                :aria-label="toggleLabel"
                :aria-pressed="amountVisible"
                @click="amountVisible = !amountVisible"
              >
                <FaIcon
                  :name="amountVisible ? 'i-lucide:eye' : 'i-lucide:eye-off'"
                  class="size-4"
                  aria-hidden="true"
                />
              </FaButton>
            </div>

            <div class="qs-personal-fund-card__amount-line">
              <template v-if="account">
                <AmountDisplay
                  v-if="amountVisible"
                  :value="account.balance"
                  :currency="account.currency"
                  :currencies="currencies"
                  class="qs-personal-fund-card__amount"
                />
                <!-- 隐藏态只输出掩码；真实余额不进入 DOM、aria-label 或 title。 -->
                <p
                  v-else
                  class="qs-personal-fund-card__amount m-0"
                  :aria-label="t('qsPersonalFundAccount.amountHidden')"
                >
                  <span aria-hidden="true">{{ maskedAmount }}</span>
                  <span class="sr-only">{{ t('qsPersonalFundAccount.amountHidden') }}</span>
                </p>
              </template>
              <p v-else class="qs-personal-fund-card__contact-finance m-0">
                {{ t('qsPersonalFundAccount.contactFinanceToOpen') }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div v-if="account" class="qs-personal-fund-card__content">
        <dl class="qs-personal-fund-card__metrics">
          <div class="qs-personal-fund-card__metric">
            <span
              class="qs-personal-fund-card__metric-icon qs-personal-fund-card__metric-icon--rate"
              aria-hidden="true"
            >
              <FaIcon name="i-lucide:percent" class="size-5" />
            </span>
            <div class="min-w-0">
              <dt class="qs-personal-fund-card__metric-label">
                {{ t('qsPersonalFundAccount.shareRate') }}
              </dt>
              <dd class="qs-personal-fund-card__metric-value">
                {{ shareRateText }}
              </dd>
              <dd class="qs-personal-fund-card__metric-sub">
                <span class="flex flex-wrap gap-x-1 items-baseline">
                  <span>{{ t('qsPersonalFundAccount.rateEffectiveAt') }}</span>
                  <DateTimeDisplay :value="account.shareRateUpdatedAt" format="date" />
                  <DateTimeDisplay
                    :value="account.shareRateUpdatedAt"
                    format="time"
                    class="qs-personal-fund-card__time"
                  />
                </span>
              </dd>
            </div>
          </div>

          <div class="qs-personal-fund-card__metric">
            <span
              class="qs-personal-fund-card__metric-icon qs-personal-fund-card__metric-icon--muted"
              aria-hidden="true"
            >
              <FaIcon name="i-lucide:clock-3" class="size-5" />
            </span>
            <div class="min-w-0">
              <dt class="qs-personal-fund-card__metric-label">
                {{ t('qsPersonalFundAccount.lastAccountUpdate') }}
              </dt>
              <dd class="qs-personal-fund-card__metric-date">
                <DateTimeDisplay
                  :value="account.updatedAt"
                  format="date"
                  class="qs-personal-fund-card__metric-date-value"
                />
                <DateTimeDisplay
                  :value="account.updatedAt"
                  format="time"
                  class="qs-personal-fund-card__metric-date-value qs-personal-fund-card__time"
                />
              </dd>
              <dd class="qs-personal-fund-card__metric-sub">
                {{ t('qsPersonalFundAccount.systemSynced') }}
              </dd>
            </div>
          </div>

          <div class="qs-personal-fund-card__metric">
            <span
              class="qs-personal-fund-card__metric-icon qs-personal-fund-card__metric-icon--muted"
              aria-hidden="true"
            >
              <FaIcon name="i-lucide:calendar" class="size-5" />
            </span>
            <div class="min-w-0">
              <dt class="qs-personal-fund-card__metric-label">
                {{ t('qsPersonalFundAccount.accountOpenedAt') }}
              </dt>
              <dd class="qs-personal-fund-card__metric-date">
                <DateTimeDisplay
                  :value="account.createdAt"
                  format="date"
                  class="qs-personal-fund-card__metric-date-value"
                />
                <DateTimeDisplay
                  :value="account.createdAt"
                  format="time"
                  class="qs-personal-fund-card__metric-date-value qs-personal-fund-card__time"
                />
              </dd>
              <dd class="qs-personal-fund-card__metric-sub">
                {{ t('qsPersonalFundAccount.firstActivated') }}
              </dd>
            </div>
          </div>
        </dl>

        <div class="qs-personal-fund-card__actions">
          <FaButton class="h-11 w-full" @click="emit('applyWithdrawal')">
            <FaIcon name="i-lucide:banknote" aria-hidden="true" />
            {{ t('qsPersonalFundAccount.applyWithdrawal') }}
          </FaButton>
          <FaButton variant="outline" class="h-11 w-full" @click="emit('viewWithdrawals')">
            <FaIcon name="i-lucide:history" aria-hidden="true" />
            {{ t('qsPersonalFundAccount.withdrawalRecords') }}
          </FaButton>
        </div>
      </div>
      <div v-else class="qs-personal-fund-card__content qs-personal-fund-card__content--empty">
        <p class="qs-type-description m-0 max-w-sm">
          {{ t('qsPersonalFundAccount.openAccountHint') }}
        </p>
      </div>
    </div>
  </FaCard>
</template>

<style scoped>
/*
 * 卡片自己就是容器：页面带侧边栏、分栏或抽屉时，卡片宽度与视口宽度不一致，
 * 因此宽/窄形态只按容器宽度切换，与项目既有 QsOceanContainerList 的做法一致。
 */
.qs-personal-fund-card {
  container-type: inline-size;
}

/*
 * 余额面板最小宽度按「负号 + ¥ + 6 位整数（含千分位）+ 2 位小数 + CNY」
 * 在当前最大金额字号下计算：16 个等宽字符 + 左右 1.5rem 内边距 ≈ 432px，
 * 面板保留 460px 最小宽度留出余量。窄屏金额字号随容器缩小。
 */
.qs-personal-fund-card__layout {
  display: grid;
  grid-template-columns: minmax(460px, 26%) minmax(0, 1fr);
  min-height: 15rem;
}

.qs-personal-fund-card__balance {
  position: relative;
  overflow: hidden;
  display: flex;
  padding: 1.5rem;
  background: oklch(var(--primary));
  color: oklch(var(--primary-foreground));
}

/* 负数余额使用项目 amber 语义色；深色文字保证黄色背景上的可读性。 */
.qs-personal-fund-card__balance--yellow {
  background: oklch(0.769 0.188 70.08);
  color: oklch(0.216 0.006 56.043);
}

/* 未开户使用项目 destructive 语义色，与既有危险按钮同色系。 */
.qs-personal-fund-card__balance--red {
  background: oklch(var(--destructive));
  color: oklch(1 0 0);
}

.qs-personal-fund-card__balance-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
}

/* 装饰圆只做同色系层次，不接鼠标事件，也不参与读屏。 */
.qs-personal-fund-card__circle {
  position: absolute;
  pointer-events: none;
  border-radius: 9999px;
  background: color-mix(in oklab, currentColor 9%, transparent);
}

.qs-personal-fund-card__circle--top {
  top: -8rem;
  right: -7rem;
  width: 20rem;
  height: 20rem;
}

.qs-personal-fund-card__circle--bottom {
  bottom: -7rem;
  left: -3rem;
  width: 12rem;
  height: 12rem;
  background: color-mix(in oklab, currentColor 7%, transparent);
}

.qs-personal-fund-card__title-icon {
  background: color-mix(in oklab, currentColor 15%, transparent);
}

.qs-personal-fund-card__title {
  color: currentColor;
  font-family: var(--qs-font-sans);
  font-size: var(--qs-type-size-lg);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-lg);
  letter-spacing: var(--qs-type-tracking-normal);
}

.qs-personal-fund-card__balance-label {
  color: color-mix(in oklab, currentColor 88%, transparent);
  font-family: var(--qs-font-sans);
  font-size: var(--qs-type-size-sm);
  font-weight: var(--qs-type-weight-medium);
  line-height: var(--qs-type-leading-sm);
}

/* 金额可能很宽：容器内横向滚动兜底，绝不截断数字；隐藏态复用同一排版高度。 */
.qs-personal-fund-card__amount-line {
  overflow-x: auto;
  /* overflow-x 非 visible 时另一轴会计算为 auto；显式关掉纵向，避免出现竖向滚动条。 */
  overflow-y: hidden;
  min-width: 0;
  padding-bottom: 0.125rem;
}

.qs-personal-fund-card__amount {
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  color: currentColor;
  font-family: var(--qs-font-mono);
  /* 上限 2.5rem 与面板 460px 最小宽度配套，保证最大金额字符串不溢出。 */
  font-size: clamp(1.75rem, 2.7cqw, 2.5rem);
  font-weight: var(--qs-type-weight-bold);
  line-height: 1.15;
  letter-spacing: var(--qs-type-tracking-tight);
  font-variant-numeric: tabular-nums;
  text-align: left;
  white-space: nowrap;
}

/* 未开户时金额位展示开户提示，沿用面板当前文字色。 */
.qs-personal-fund-card__contact-finance {
  color: currentColor;
  font-family: var(--qs-font-sans);
  font-size: clamp(1.125rem, 1.6cqw, 1.5rem);
  font-weight: var(--qs-type-weight-semibold);
  line-height: 1.3;
  letter-spacing: var(--qs-type-tracking-normal);
}

.qs-personal-fund-card__visibility-toggle {
  flex-shrink: 0;
  color: color-mix(in oklab, currentColor 85%, transparent);
}

.qs-personal-fund-card__visibility-toggle:hover {
  color: currentColor;
  background: color-mix(in oklab, currentColor 12%, transparent);
}

.qs-personal-fund-card__visibility-toggle:focus-visible {
  outline: 2px solid color-mix(in oklab, currentColor 75%, transparent);
  outline-offset: 2px;
}

.qs-personal-fund-card__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 未开户时右侧仅保留说明，避免出现无数据的指标和操作列。 */
.qs-personal-fund-card__content--empty {
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  text-align: center;
}

.qs-personal-fund-card__metrics {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: center;
  gap: 1rem;
  margin: 0;
  padding: 1.25rem 1.75rem;
  min-width: 0;
}

.qs-personal-fund-card__metric {
  display: flex;
  gap: 0.75rem;
  min-width: 0;
}

.qs-personal-fund-card__metric + .qs-personal-fund-card__metric {
  border-left: 1px solid oklch(var(--border));
  padding-left: 1rem;
}

.qs-personal-fund-card__metric-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
}

.qs-personal-fund-card__metric-icon--rate {
  color: oklch(var(--primary));
  background: color-mix(in oklab, oklch(var(--primary)) 10%, transparent);
}

.qs-personal-fund-card__metric-icon--muted {
  color: oklch(var(--muted-foreground));
  background: oklch(var(--muted));
}

.qs-personal-fund-card__metric-label {
  color: oklch(var(--muted-foreground));
  font-family: var(--qs-font-sans);
  font-size: var(--qs-type-size-sm);
  font-weight: var(--qs-type-weight-regular);
  line-height: var(--qs-type-leading-sm);
}

.qs-personal-fund-card__metric-value {
  margin: 0.125rem 0 0;
  color: oklch(var(--foreground));
  font-family: var(--qs-font-sans);
  font-size: var(--qs-type-size-md);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-md);
}

/* 日期默认一行展示；窄容器改为日期 / 时间两行，与设计图 2 一致。 */
.qs-personal-fund-card__metric-date {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.25rem;
  margin: 0.125rem 0 0;
}

.qs-personal-fund-card__metric-date-value {
  color: oklch(var(--foreground));
  font-size: var(--qs-type-size-md);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-md);
}

.qs-personal-fund-card__metric-sub {
  margin: 0.25rem 0 0;
  color: oklch(var(--muted-foreground));
  font-family: var(--qs-font-sans);
  font-size: var(--qs-type-size-xs);
  font-weight: var(--qs-type-weight-regular);
  line-height: var(--qs-type-leading-xs);
}

.qs-personal-fund-card__actions {
  display: flex;
  flex-direction: row;
  gap: 0.75rem;
  padding: 1rem 1.75rem 1.25rem;
  border-top: 1px solid oklch(var(--border));
  min-width: 0;
}

.qs-personal-fund-card__actions > * {
  flex: 1 1 0;
}

@container (width < 1140px) {
  .qs-personal-fund-card__layout {
    grid-template-columns: minmax(300px, 32%) minmax(0, 1fr);
  }

  .qs-personal-fund-card__metrics {
    padding: 1.25rem 1.5rem;
  }

  .qs-personal-fund-card__actions {
    padding: 1rem 1.5rem 1.25rem;
  }

  /* 窄容器只保留日期；具体时间在宽容器才展示。 */
  .qs-personal-fund-card__time {
    display: none;
  }

  .qs-personal-fund-card__metric-date {
    flex-direction: column;
    gap: 0;
  }
}

@container (width < 840px) {
  .qs-personal-fund-card__layout {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }

  .qs-personal-fund-card__balance {
    min-height: 12rem;
  }

  .qs-personal-fund-card__balance-content {
    gap: 1rem;
  }

  .qs-personal-fund-card__metrics {
    grid-template-columns: minmax(0, 1fr);
    padding: 1.25rem 1.5rem;
  }

  .qs-personal-fund-card__metric + .qs-personal-fund-card__metric {
    border-top: 1px solid oklch(var(--border));
    border-left: 0;
    padding-top: 1.25rem;
    padding-left: 0;
  }

  .qs-personal-fund-card__actions {
    flex-direction: column;
    padding: 1rem 1.5rem 1.25rem;
  }

  .qs-personal-fund-card__actions > * {
    flex: 0 0 auto;
    width: 100%;
  }
}
</style>

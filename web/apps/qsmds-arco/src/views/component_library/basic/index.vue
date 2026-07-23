<script setup lang="ts">
import type { CurrencyAmountValue, CurrencyCode } from '@/components/base/AmountDisplay/format'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'

defineOptions({ name: 'ComponentLibraryAmountDisplay' })

const principles = [
  {
    title: '保持低业务耦合',
    description: '通过 props、emits 和 slots 表达稳定接口，不读取业务 Store，也不直接调用领域 API。',
    icon: 'i-lucide:unplug',
  },
  {
    title: '覆盖完整状态',
    description: '组件进入正式页面前，需要检查默认、空值、加载、禁用、只读和错误边界。',
    icon: 'i-lucide:list-checks',
  },
  {
    title: '适配真实布局',
    description: '同时验证桌面与窄屏环境，优先使用现有主题 token 和 Fantastic-admin 能力。',
    icon: 'i-lucide:panels-top-left',
  },
] as const

interface CurrencyExample {
  currency: CurrencyCode
  description: string
  label: string
  value: CurrencyAmountValue
}

const currencyExamples: readonly CurrencyExample[] = [
  {
    currency: 'CNY',
    description: '人民币结算金额',
    label: '人民币',
    value: '12846.37',
  },
  {
    currency: 'TWD',
    description: '台币渠道金额',
    label: '台币',
    value: '384590',
  },
  {
    currency: 'MYR',
    description: '马来西亚林吉特金额',
    label: '林吉特',
    value: '27518.4',
  },
  {
    currency: 'USD',
    description: '美元调整金额',
    label: '美元',
    value: '-864.72',
  },
]

const stateExamples: readonly CurrencyExample[] = [
  { currency: 'CNY', description: '固定补齐两位小数', label: '零值', value: 0 },
  { currency: 'USD', description: '负号位于货币符号之前', label: '负数', value: '-4287.65' },
  { currency: 'TWD', description: '字符串输入保持安全整数外精度', label: '大额', value: '9007199254740993.21' },
  { currency: 'MYR', description: '第三位小数执行 half-up', label: '舍入', value: '128.345' },
  { currency: 'CNY', description: '空值统一显示占位符', label: '空值', value: null },
]
</script>

<template>
  <ComponentCatalogPage
    title="金额显示"
    description="独立验收 AmountDisplay 的多币种、精度、舍入和空值边界。"
    section-label="AmountDisplay"
    headline="稳定显示四种结算币种"
    summary="金额组件只负责格式化展示，不读取业务 Store 或调用 API。精确金额优先传入十进制字符串，统一输出币种符号、千分位和两位小数。"
    route-path="/component-library/basic/amount-display"
    icon="i-lucide:badge-dollar-sign"
    :principles="principles"
    stage-label="金额组件已展示"
    empty-description="金额组件示例尚未接入。"
  >
    <section aria-labelledby="amount-display-title">
      <div class="p-5 border border-border rounded-xl bg-background sm-p-7">
        <div class="flex flex-wrap gap-4 items-start justify-between">
          <div class="min-w-0">
            <div class="text-primary flex gap-2 items-center">
              <FaIcon name="i-lucide:badge-dollar-sign" class="size-5" />
              <span class="text-xs tracking-[0.16em] font-semibold">基础显示组件</span>
            </div>
            <h3 id="amount-display-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm-text-2xl">
              金额格式化显示
            </h3>
            <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
              统一币种符号、千分位和两位小数。精确金额优先传入十进制字符串，组件只负责展示，不读取业务状态。
            </p>
          </div>
          <FaTag variant="secondary">
            AmountDisplay
          </FaTag>
        </div>

        <div class="mt-7 gap-8 grid lg-grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.7fr)]">
          <div class="border-y border-border divide-border divide-y">
            <article
              v-for="example in currencyExamples"
              :key="example.currency"
              class="py-5 gap-4 grid items-center sm-grid-cols-[minmax(0,1fr)_auto]"
            >
              <div class="min-w-0">
                <div class="flex gap-2 items-center">
                  <span class="text-sm font-semibold">{{ example.label }}</span>
                  <code class="text-xs text-muted-foreground">{{ example.currency }}</code>
                </div>
                <p class="text-xs text-muted-foreground m-0 mt-1">
                  {{ example.description }}
                </p>
              </div>
              <AmountDisplay
                :value="example.value"
                :currency="example.currency"
                class="text-xl sm-text-2xl"
              />
            </article>
          </div>

          <aside class="p-5 border border-border rounded-xl bg-muted/20 self-start">
            <p class="text-xs text-primary tracking-[0.16em] font-semibold m-0">
              稳定接口
            </p>
            <dl class="text-sm m-0 mt-5 space-y-4">
              <div class="pb-4 border-b border-border">
                <dt class="text-muted-foreground">
                  value
                </dt>
                <dd class="text-xs font-mono m-0 mt-1 break-all">
                  string | number | null
                </dd>
              </div>
              <div class="pb-4 border-b border-border">
                <dt class="text-muted-foreground">
                  currency
                </dt>
                <dd class="text-xs font-mono m-0 mt-1 break-all">
                  CNY | TWD | MYR | USD
                </dd>
              </div>
              <div class="pb-4 border-b border-border">
                <dt class="text-muted-foreground">
                  小数位与舍入
                </dt>
                <dd class="text-xs leading-5 m-0 mt-1">
                  固定两位，十进制 half-up
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">
                  依赖边界
                </dt>
                <dd class="text-xs leading-5 m-0 mt-1">
                  无 API、Store 或示例 fixture 依赖
                </dd>
              </div>
            </dl>
          </aside>
        </div>

        <div class="mt-8 pt-7 border-t border-border">
          <div class="flex flex-wrap gap-3 items-end justify-between">
            <div>
              <h4 class="text-base font-semibold m-0">
                边界状态
              </h4>
              <p class="text-xs text-muted-foreground m-0 mt-1">
                同一组件直接覆盖常见显示边界。
              </p>
            </div>
            <span class="text-xs text-muted-foreground">只读展示</span>
          </div>

          <div class="mt-4 border-y border-border divide-border divide-y">
            <div
              v-for="example in stateExamples"
              :key="example.label"
              class="py-4 gap-3 grid items-center sm-grid-cols-[7rem_minmax(0,1fr)_auto]"
            >
              <span class="text-sm font-medium">{{ example.label }}</span>
              <span class="text-xs text-muted-foreground">{{ example.description }}</span>
              <AmountDisplay
                :value="example.value"
                :currency="example.currency"
                class="text-base"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  </ComponentCatalogPage>
</template>

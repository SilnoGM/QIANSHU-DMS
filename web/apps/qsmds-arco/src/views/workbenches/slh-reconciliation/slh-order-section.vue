<script setup lang="ts">
import type { SlhReconciliationLineField, SlhReconciliationOrderSection } from './detail.logic'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'
import SlhReconciliationOverflowText from './overflow-text.vue'

/**
 * 对账详情的单个销售/采购区块。
 *
 * 从详情页抽出，供普通行与翻转卡的正面/背面共用；只负责渲染模型，
 * 不判断当前单/原单，也不读接口。`beam` 由模型决定（只有核对焦点所在的销售段开）。
 */
defineOptions({ name: 'SlhOrderSection' })

defineProps<{
  readonly section: SlhReconciliationOrderSection
}>()

const currencyCatalog = useCurrencyCatalog()

/** 金额行间距：总额行之后用一条虚线分开，其余行只靠行距区分。 */
function amountRowClass(index: number): string {
  return index === 1 ? 'pt-2 border-t border-dashed border-border' : ''
}

/** 金额块样式：总额大号加粗，余额非零时染红（标记由 logic 判断后下发）。 */
function amountClass(field: SlhReconciliationLineField): string {
  if (field.emphasis === 'total') {
    return '!text-xl !font-semibold'
  }
  return field.emphasis === 'balance' ? '!text-destructive' : ''
}
</script>

<template>
  <section class="min-w-0" :aria-label="section.label">
    <!-- 区块标题：竖条沿用采购订单详情的分区标题范式（纯装饰，不进无障碍树）。 -->
    <h2 class="qs-type-section-title m-0 flex gap-2 items-center">
      <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
      {{ section.label }}
    </h2>
    <!-- 信息块：单号单独一行，下面一行三个状态徽章。 -->
    <div class="mt-3 p-3 rounded-lg bg-muted/40 flex flex-col gap-2 min-w-0">
      <p class="qs-type-data-emphasis m-0 break-all">
        {{ section.orderNo.value }}
      </p>
      <div v-if="section.states.length > 0" class="flex flex-wrap gap-1.5">
        <FaTag
          v-for="state in section.states"
          :key="state.dimension"
          variant="outline"
          class="qs-type-status-tag"
          :class="resolveStatusTagToneClass(state.tone)"
          :aria-label="`${state.dimension}：${state.label}`"
        >
          {{ state.label }}
        </FaTag>
      </div>
    </div>
    <!-- 关键字段行：客户信息（姓名 · 电话合并）、完整地址、出单人 / 供应商、采购唛头、采购人。 -->
    <dl class="m-0 mt-3 flex flex-col gap-2">
      <div
        v-for="field in section.fields"
        :key="field.id"
        class="gap-x-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline"
      >
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ field.label }}
        </dt>
        <dd class="m-0 break-all">
          <!-- 人员行：姓名交给 QsPersonDisplay（头像位 + 单行截断 + 悬停完整名）。 -->
          <QsPersonDisplay
            v-if="field.person"
            :display-name="field.person"
            :avatar-url="field.personAvatarUrl ?? null"
            size="sm"
            class="max-w-full"
          />
          <!-- 长文本行：单行截断，只有真的截断了才给悬停提示。 -->
          <SlhReconciliationOverflowText
            v-else-if="field.truncate"
            :text="field.value"
          />
          <span v-else class="qs-type-data">
            {{ field.value }}
          </span>
        </dd>
      </div>
    </dl>
    <!-- 金额块：总额大号加粗右对齐，虚线之后是三项明细，末行余额非零时染红。 -->
    <dl class="m-0 mt-3 p-3 border border-border rounded-lg flex flex-col gap-2 relative overflow-hidden">
      <!-- 核对焦点块：流光边框只作视觉重心，纯装饰不进无障碍树。 -->
      <FaBorderBeam
        v-if="section.beam"
        :size="200"
        :duration="5000"
        :border-width="2"
        color-from="oklch(var(--primary))"
        color-to="oklch(var(--primary) / 0.15)"
        class="motion-reduce:hidden"
        aria-hidden="true"
      />

      <div
        v-for="(field, index) in section.amountFields"
        :key="field.id"
        class="gap-x-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline"
        :class="amountRowClass(index)"
      >
        <dt
          class="qs-type-compact-label"
          :class="field.emphasis === 'total' ? 'text-foreground' : 'text-muted-foreground'"
        >
          {{ field.label }}
        </dt>
        <dd class="m-0 text-right">
          <!-- 金额统一走 AmountDisplay（符号、千分位与币种精度）；右对齐由本行给定。 -->
          <AmountDisplay
            v-if="field.amount"
            :value="field.amount.value"
            :currency="field.amount.currency"
            :currencies="currencyCatalog.currencies.value"
            :class="amountClass(field)"
          />
          <span v-else class="qs-type-data">
            {{ field.value }}
          </span>
        </dd>
      </div>
    </dl>
  </section>
</template>

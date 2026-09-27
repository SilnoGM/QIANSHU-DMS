<script setup lang="ts">
import type { SlhBillDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { formatSlhBillRate, resolveSlhBillContainerBatchPreview } from './display.logic'

const props = defineProps<{
  bill: SlhBillDto
  downloading: boolean
}>()

const emit = defineEmits<{ download: [] }>()

const { t } = useI18n()
const batchesExpanded = ref(false)
const batchPreview = computed(() => resolveSlhBillContainerBatchPreview(props.bill.containerBatchNames))
// 折叠只影响渲染范围，不改变取到的柜号集合。
const visibleBatches = computed(() => batchesExpanded.value ? props.bill.containerBatchNames : batchPreview.value.visible)
</script>

<template>
  <!--
    窄屏三分节纵向堆叠，xl 起改为并列三栏：信息卡在首屏只占一块的高度，
    把对账核对区块顶上来；栏间用左边框分隔，符合“靠边框与留白分层”的口径。
  -->
  <div class="gap-6 grid min-w-0 xl:grid-cols-3">
    <section class="min-w-0" :aria-label="t('slhBill.info.meta')">
      <h3 class="qs-type-component-title m-0 mb-3">
        {{ t('slhBill.info.meta') }}
      </h3>
      <dl class="m-0 gap-x-6 gap-y-4 grid min-w-0 sm:grid-cols-2 xl:grid-cols-2">
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.column.billMonth') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1.5">
            {{ bill.billMonth }}
          </dd>
        </div>
        <div class="min-w-0 xl:col-span-2">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.column.period') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1.5">
            {{ bill.periodStart }} ~ {{ bill.periodEnd }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.column.lineCount') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1.5">
            {{ bill.lineCount }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.column.containerBatchCount') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1.5">
            {{ bill.containerBatchCount }}
          </dd>
        </div>
        <div v-if="bill.remark" class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.column.remark') }}
          </dt>
          <dd class="qs-type-body m-0 mt-1.5 [overflow-wrap:anywhere]">
            {{ bill.remark }}
          </dd>
        </div>
      </dl>
    </section>

    <section class="mt-5 pt-5 border-t border-border min-w-0 xl:mt-0 xl:pl-6 xl:pt-0 xl:border-l xl:border-t-0" :aria-label="t('slhBill.info.rate')">
      <h3 class="qs-type-component-title m-0 mb-3">
        {{ t('slhBill.info.rate') }}
      </h3>
      <p v-if="!bill.rate" class="qs-type-meta text-muted-foreground m-0">
        {{ t('slhBill.noRate') }}
      </p>
      <dl v-else class="m-0 gap-x-6 gap-y-4 grid min-w-0 sm:grid-cols-2 xl:grid-cols-2">
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.column.rateSource') }}
          </dt>
          <dd class="m-0 mt-1.5">
            <FaTag variant="outline" class="qs-type-status-tag">
              {{ t(`slhBill.rateSource.${bill.rate.source}`) }}
            </FaTag>
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.rateValue') }}
          </dt>
          <dd class="qs-type-data-emphasis m-0 mt-1.5 tabular-nums">
            {{ formatSlhBillRate(bill.rate.foreignUnitsPerCny) ?? t('slhBill.valueMissing') }}
          </dd>
        </div>
        <div v-if="bill.rate.embeddedForeignUnitsPerCny" class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.rateEmbedded') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1.5 tabular-nums">
            {{ formatSlhBillRate(bill.rate.embeddedForeignUnitsPerCny) ?? t('slhBill.valueMissing') }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.rateCapturedAt') }}
          </dt>
          <dd class="m-0 mt-1.5">
            <DateTimeDisplay :value="bill.rate.capturedAt" />
          </dd>
        </div>
      </dl>
    </section>

    <section class="mt-5 pt-5 border-t border-border min-w-0 xl:mt-0 xl:pl-6 xl:pt-0 xl:border-l xl:border-t-0" :aria-label="t('slhBill.info.source')">
      <h3 class="qs-type-component-title m-0 mb-3">
        {{ t('slhBill.info.source') }}
      </h3>
      <dl class="m-0 gap-x-6 gap-y-4 grid min-w-0 sm:grid-cols-2 xl:grid-cols-2">
        <div class="min-w-0 sm:col-span-2 xl:col-span-2">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.sourceFile') }}
          </dt>
          <dd class="m-0 mt-1.5 flex flex-wrap gap-3 items-center">
            <span class="qs-type-body min-w-0 [overflow-wrap:anywhere]">{{ bill.sourceFileName }}</span>
            <FaButton variant="outline" size="sm" :disabled="downloading" @click="emit('download')">
              <FaIcon name="i-lucide:download" aria-hidden="true" />{{ t('slhBill.download') }}
            </FaButton>
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.column.created') }}
          </dt>
          <dd class="qs-type-body m-0 mt-1.5">
            {{ bill.createdByDisplayName }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('slhBill.column.createdAt') }}
          </dt>
          <dd class="m-0 mt-1.5">
            <DateTimeDisplay :value="bill.createdAt" />
          </dd>
        </div>
      </dl>
    </section>

    <!-- 柜号清单铺满整行：它是唯一会折行的长清单，挤在单栏里会把信息卡撑高一截。 -->
    <section class="pt-5 border-t border-border min-w-0 sm:col-span-2 xl:col-span-3" :aria-label="t('slhBill.containerBatches')">
      <dl class="m-0 min-w-0">
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('slhBill.containerBatches') }}
        </dt>
        <dd class="m-0 mt-2 flex flex-wrap gap-2 items-center">
          <FaTag v-for="name in visibleBatches" :key="name" variant="outline" class="qs-type-data max-w-full whitespace-normal break-words">
            {{ name }}
          </FaTag>
          <FaButton v-if="batchPreview.hiddenCount > 0" variant="ghost" size="sm" @click="batchesExpanded = !batchesExpanded">
            {{ batchesExpanded ? t('slhBill.info.collapseBatches') : t('slhBill.info.expandBatches', { count: bill.containerBatchNames.length }) }}
          </FaButton>
        </dd>
      </dl>
    </section>
  </div>
</template>

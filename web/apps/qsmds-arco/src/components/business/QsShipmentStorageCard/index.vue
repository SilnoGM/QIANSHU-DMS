<script setup lang="ts">
import type { Ref } from 'vue'
import type { QsShipmentStorageCardProps } from './types'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { resolveStorageCardLocation, resolveStorageCardMarks, resolveStorageCardProducts } from './logic'

/**
 * 寄仓记录卡片。
 *
 * 纯展示组件：列表数据、状态文案、可申请状态和操作结果由页面负责；卡片不读
 * API、Store 或路由。宽/窄形态按卡片自身宽度切换，避免页面侧边栏改变视口宽度
 * 后误判布局。
 */
defineOptions({ name: 'QsShipmentStorageCard' })

const props = withDefaults(defineProps<QsShipmentStorageCardProps>(), {
  applyDisabledReason: null,
})

const emit = defineEmits<{
  detail: []
  apply: []
}>()

const toast = useQsToast()

const productSummary = computed(() => resolveStorageCardProducts(props.record.lineSummary))
const firstProduct = computed(() => productSummary.value.product)
const location = computed(() => resolveStorageCardLocation(props.record))
const shippingMark = computed(() => props.record.shippingMarkText?.trim() || null)
const markItems = computed(() => props.record.containerMarks.map(mark => mark.trim()).filter(Boolean))
const markVisibleCount = ref(2)
const containerMarks = computed(() => resolveStorageCardMarks(props.record.containerMarks, markVisibleCount.value))
const canCopyContainerMarks = computed(() => containerMarks.value.fullText !== '—')
const applyDisabled = computed(() => props.applyDisabledReason !== null)
const shipmentCardId = computed(() => `shipment-card-${props.record.id}`)
const shipmentLabel = computed(() => props.record.shipmentNo ?? '寄仓记录')
const detailLabel = computed(() => `${shipmentLabel.value}：详情`)
const applyLabel = computed(() => `${shipmentLabel.value}：申请调货`)

const factsRef = ref<HTMLElement | null>(null)
const markValueRef = ref<HTMLElement | null>(null)
const markMeasureRef = ref<HTMLElement | null>(null)
const salesValueRef = ref<HTMLElement | null>(null)
const salesMeasureRef = ref<HTMLElement | null>(null)
const purchaseValueRef = ref<HTMLElement | null>(null)
const purchaseMeasureRef = ref<HTMLElement | null>(null)
const salesPersonHidden = ref(false)
const purchasePersonHidden = ref(false)

let resizeObserver: ResizeObserver | null = null
let measureFrame: number | undefined
let lastFactsWidth = 0

function markCandidateText(count: number): string {
  const visible = markItems.value.slice(0, count).join('、')
  const hidden = markItems.value.length - count
  return `${visible}${hidden > 0 ? ` +${hidden}` : ''}`
}

function measureMarkCount(): void {
  const value = markValueRef.value
  const measure = markMeasureRef.value
  if (!value || !measure) {
    return
  }
  if (markItems.value.length === 0) {
    markVisibleCount.value = 0
    return
  }

  const available = value.clientWidth
  let chosen = 1
  for (let count = markItems.value.length; count >= 1; count -= 1) {
    measure.textContent = markCandidateText(count)
    if (measure.getBoundingClientRect().width <= available + 0.5) {
      chosen = count
      break
    }
  }
  markVisibleCount.value = chosen
}

function measureSourcePair(
  value: HTMLElement | null,
  measure: HTMLElement | null,
  hidden: Ref<boolean>,
): void {
  if (!value || !measure) {
    return
  }
  hidden.value = measure.getBoundingClientRect().width > value.clientWidth + 0.5
}

function measureContent(): void {
  measureMarkCount()
  measureSourcePair(salesValueRef.value, salesMeasureRef.value, salesPersonHidden)
  measureSourcePair(purchaseValueRef.value, purchaseMeasureRef.value, purchasePersonHidden)
}

function scheduleMeasurement(): void {
  if (measureFrame !== undefined) {
    cancelAnimationFrame(measureFrame)
  }
  measureFrame = requestAnimationFrame(() => {
    measureFrame = undefined
    measureContent()
  })
}

function handleFactsResize(entries: ResizeObserverEntry[]): void {
  const width = entries[0]?.contentRect.width ?? 0
  // 高度变化由人员收起造成；只有宽度变化才需要重新计算。
  if (Math.abs(width - lastFactsWidth) < 0.5) {
    return
  }
  lastFactsWidth = width
  scheduleMeasurement()
}

watch(markItems, () => {
  markVisibleCount.value = Math.min(2, markItems.value.length)
  scheduleMeasurement()
}, { deep: true })

watch([
  () => props.record.originIssuer,
  () => props.record.originPurchaseCreator,
  () => props.record.originSalesOrderNo,
  () => props.record.originPurchaseOrderNo,
], scheduleMeasurement, { deep: true })

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && factsRef.value) {
    resizeObserver = new ResizeObserver(handleFactsResize)
    resizeObserver.observe(factsRef.value)
    lastFactsWidth = factsRef.value.getBoundingClientRect().width
  }
  scheduleMeasurement()
  document.fonts?.ready.then(scheduleMeasurement).catch(() => undefined)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (measureFrame !== undefined) {
    cancelAnimationFrame(measureFrame)
  }
})

async function copyContainerMarks(): Promise<void> {
  if (!canCopyContainerMarks.value) {
    return
  }
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }
    await navigator.clipboard.writeText(containerMarks.value.fullText)
    toast.success('装柜唛头已复制')
  }
  catch {
    // 不把唛头内容或浏览器权限细节写入日志，失败只反馈当前用户。
    toast.error('装柜唛头复制失败')
  }
}
</script>

<template>
  <FaCard
    role="article"
    :aria-labelledby="shipmentCardId"
    data-slot="qs-shipment-storage-card"
    class="qs-shipment-storage-card py-0 rounded-xl gap-0 overflow-hidden"
    content-class="p-0"
  >
    <header class="px-4 py-3 border-b border-border">
      <div class="flex flex-wrap gap-2 min-w-0 items-center">
        <FaTag variant="outline" :class="statusClass" class="whitespace-nowrap">
          {{ statusLabel }}
        </FaTag>
        <span :id="shipmentCardId" class="qs-type-data-emphasis inline-flex min-w-0 items-center">
          <QsCopyableText v-if="record.shipmentNo" label="货件编号" :text="record.shipmentNo" />
          <span v-else>{{ shipmentLabel }}</span>
        </span>
        <span class="qs-shipment-storage-card__location text-xs text-muted-foreground flex flex-wrap gap-2 min-w-0 items-center">
          <span class="px-1.5 py-0.5 border rounded" :class="location.scopeClass">{{ location.scope }}</span>
          <span class="inline-flex gap-1 min-w-0 items-center">
            <FaIcon name="i-lucide:map-pin" class="shrink-0 size-3.5" aria-hidden="true" />
            <span class="break-words">{{ location.warehouse }}</span>
          </span>
        </span>
      </div>
      <div class="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span class="qs-shipment-storage-card__meta-item">
          <span>转入寄仓</span>
          <DateTimeDisplay :value="record.createdAt" class="qs-shipment-storage-card__meta-value" />
        </span>
        <span class="qs-shipment-storage-card__meta-item">
          <span>原单客户</span>
          <span class="qs-shipment-storage-card__meta-value">{{ record.originCustomerName }}</span>
        </span>
      </div>
    </header>

    <div class="p-4 flex flex-1 flex-col gap-3">
      <div class="qs-shipment-storage-card__product-cost">
        <section class="p-3 border border-border rounded-lg bg-muted/20 min-w-0" aria-label="产品">
          <div v-if="firstProduct" class="flex gap-3 min-w-0 items-center">
            <span class="border border-border rounded-lg bg-background flex-center shrink-0 size-11 overflow-hidden">
              <img
                v-if="firstProduct.mainImage"
                :src="firstProduct.mainImage.contentUrl"
                :alt="firstProduct.productName"
                class="h-full w-full object-contain"
                loading="lazy"
              >
              <FaIcon v-else name="i-lucide:image-off" class="text-muted-foreground size-4" aria-hidden="true" />
            </span>
            <div class="flex flex-1 flex-col gap-1 min-w-0">
              <span class="text-xs text-emerald-700 font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 self-start">
                {{ firstProduct.productNo || '自定义产品' }}
              </span>
              <FaTooltip :text="firstProduct.productName" :delay="300">
                <span class="qs-shipment-storage-card__product-name text-sm font-medium">
                  {{ firstProduct.productName }}
                </span>
              </FaTooltip>
            </div>
            <span class="text-xs font-mono shrink-0 tabular-nums">×{{ firstProduct.quantity }}</span>
          </div>
          <div v-else class="text-sm text-muted-foreground">
            —
          </div>
          <p class="text-xs text-muted-foreground mt-2" :class="firstProduct ? 'ml-14' : ''">
            <template v-if="productSummary.extraCount > 0">
              另有 <strong class="text-foreground font-medium">{{ productSummary.extraCount }} 项产品</strong>，可在详情中查看
            </template>
            <template v-else-if="productSummary.totalCount === 1">
              只有 <strong class="text-primary font-medium">1 项产品</strong>，可在详情中查看
            </template>
            <template v-else>
              本货件暂无产品
            </template>
          </p>
        </section>

        <section class="qs-shipment-storage-card__cost px-4 py-2 border-l border-border flex flex-col min-w-0 justify-center" aria-label="成本">
          <span class="text-xs text-muted-foreground">成本合计</span>
          <AmountDisplay
            :value="record.cost.totalCostCny"
            currency="CNY"
            :currencies="currencies"
            class="qs-shipment-storage-card__cost-value"
          />
        </section>
      </div>

      <dl ref="factsRef" class="qs-shipment-storage-card__facts">
        <div class="qs-shipment-storage-card__fact">
          <dt class="qs-shipment-storage-card__fact-label">
            货件唛头
          </dt>
          <dd class="qs-shipment-storage-card__fact-value">
            <span v-if="shippingMark" class="qs-shipment-storage-card__copyable text-xs min-w-0">
              <QsCopyableText label="货件唛头" :text="shippingMark" />
            </span>
            <span v-else class="text-xs">—</span>
          </dd>
        </div>
        <div class="qs-shipment-storage-card__fact">
          <dt class="qs-shipment-storage-card__fact-label">
            来源销售单
          </dt>
          <dd ref="salesValueRef" class="qs-shipment-storage-card__fact-value qs-shipment-storage-card__fact-value--source">
            <QsPersonDisplay
              v-if="record.originIssuer && !salesPersonHidden"
              :display-name="record.originIssuer.displayName"
              :avatar-url="record.originIssuer.avatarUrl"
              size="sm"
            />
            <span v-else-if="!record.originIssuer" class="text-xs text-muted-foreground">—</span>
            <span class="qs-shipment-storage-card__copyable text-xs font-mono min-w-0">
              <QsCopyableText label="销售单号" :text="record.originSalesOrderNo" />
            </span>
            <span
              ref="salesMeasureRef"
              class="qs-shipment-storage-card__measure flex gap-2 items-center"
              aria-hidden="true"
            >
              <QsPersonDisplay
                v-if="record.originIssuer"
                :display-name="record.originIssuer.displayName"
                :avatar-url="record.originIssuer.avatarUrl"
                size="sm"
              />
              <span class="text-xs font-mono">{{ record.originSalesOrderNo }}</span>
            </span>
          </dd>
        </div>
        <div class="qs-shipment-storage-card__fact">
          <dt class="qs-shipment-storage-card__fact-label">
            装柜唛头
          </dt>
          <dd ref="markValueRef" class="qs-shipment-storage-card__fact-value">
            <FaTooltip v-if="canCopyContainerMarks" :text="containerMarks.fullText" :delay="300">
              <button
                type="button"
                class="qs-shipment-storage-card__copy-action text-xs p-0 text-left border-0 rounded-sm bg-transparent underline-offset-2 decoration-dotted cursor-pointer break-all [color:inherit] [font:inherit] hover:text-primary focus-visible:outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                :aria-label="`复制装柜唛头：${containerMarks.fullText}`"
                @click="copyContainerMarks"
              >
                {{ containerMarks.visibleText }}<span v-if="containerMarks.hiddenCount > 0" class="whitespace-nowrap"> +{{ containerMarks.hiddenCount }}</span>
              </button>
            </FaTooltip>
            <span v-else class="text-xs">—</span>
            <span ref="markMeasureRef" class="qs-shipment-storage-card__measure" aria-hidden="true" />
          </dd>
        </div>
        <div class="qs-shipment-storage-card__fact">
          <dt class="qs-shipment-storage-card__fact-label">
            来源采购单
          </dt>
          <dd ref="purchaseValueRef" class="qs-shipment-storage-card__fact-value qs-shipment-storage-card__fact-value--source">
            <QsPersonDisplay
              v-if="record.originPurchaseCreator && !purchasePersonHidden"
              :display-name="record.originPurchaseCreator.displayName"
              :avatar-url="record.originPurchaseCreator.avatarUrl"
              size="sm"
            />
            <span v-else-if="!record.originPurchaseCreator" class="text-xs text-muted-foreground">—</span>
            <span class="qs-shipment-storage-card__copyable text-xs font-mono min-w-0">
              <QsCopyableText label="采购单号" :text="record.originPurchaseOrderNo" />
            </span>
            <span
              ref="purchaseMeasureRef"
              class="qs-shipment-storage-card__measure flex gap-2 items-center"
              aria-hidden="true"
            >
              <QsPersonDisplay
                v-if="record.originPurchaseCreator"
                :display-name="record.originPurchaseCreator.displayName"
                :avatar-url="record.originPurchaseCreator.avatarUrl"
                size="sm"
              />
              <span class="text-xs font-mono">{{ record.originPurchaseOrderNo }}</span>
            </span>
          </dd>
        </div>
      </dl>
    </div>

    <footer class="qs-shipment-storage-card__footer px-4 py-3 border-t border-border bg-muted/20 flex flex-wrap gap-2 justify-end">
      <div class="qs-shipment-storage-card__actions flex gap-2">
        <FaButton
          variant="outline"
          size="sm"
          class="min-h-11 sm:min-h-8"
          :aria-label="detailLabel"
          @click="emit('detail')"
        >
          详情
        </FaButton>
        <FaTooltip :text="applyDisabledReason ?? ''" :disabled="!applyDisabled">
          <span class="inline-flex" tabindex="0">
            <FaButton
              size="sm"
              class="min-h-11 sm:min-h-8"
              :disabled="applyDisabled"
              :aria-label="applyLabel"
              @click="emit('apply')"
            >
              申请调货
            </FaButton>
          </span>
        </FaTooltip>
      </div>
    </footer>
  </FaCard>
</template>

<style scoped>
/* 卡片自身是容器：页面侧边栏、列表列数变化时，宽窄形态仍按实际卡片宽度判断。 */
.qs-shipment-storage-card {
  container-type: inline-size;
}

.qs-shipment-storage-card__location {
  margin-left: auto;
}

.qs-shipment-storage-card__meta-item {
  display: inline-flex;
  gap: 0.25rem;
  align-items: baseline;
  white-space: nowrap;
}

.qs-shipment-storage-card__meta-value {
  font-size: inherit;
  font-weight: var(--qs-type-weight-regular);
  line-height: inherit;
  color: oklch(var(--foreground));
}

.qs-shipment-storage-card__product-cost {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 14rem;
}

.qs-shipment-storage-card__product-name {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
}

.qs-shipment-storage-card__cost-value {
  align-self: flex-start;
  justify-content: flex-start;
  margin-top: 0.25rem;
  font-family: var(--qs-font-mono);
  font-size: 1.625rem;
  font-weight: var(--qs-type-weight-bold);
  line-height: 1.15;
  text-align: left;
  letter-spacing: var(--qs-type-tracking-tight);
}

.qs-shipment-storage-card__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1.5rem;
  padding: 0.75rem;
  border: 1px solid oklch(var(--border));
  border-radius: 0.5rem;
}

.qs-shipment-storage-card__fact {
  display: grid;
  grid-template-columns: 4.25rem minmax(0, 1fr);
  gap: 0.5rem;
  align-items: center;
  min-width: 0;
}

.qs-shipment-storage-card__fact-label {
  font-size: var(--qs-type-size-xs);
  color: oklch(var(--muted-foreground));
  white-space: nowrap;
}

.qs-shipment-storage-card__fact-value {
  position: relative;
  display: flex;
  gap: 0.375rem;
  align-items: center;
  min-width: 0;
  margin: 0;
  font-size: var(--qs-type-size-xs);
}

.qs-shipment-storage-card__measure {
  position: absolute;
  top: 0;
  left: 0;
  display: inline-flex;
  visibility: hidden;
  width: max-content;
  white-space: nowrap;
  pointer-events: none;
}

.qs-shipment-storage-card__fact-value--source {
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
}

.qs-shipment-storage-card__copyable {
  min-width: 0;
}

.qs-shipment-storage-card__copyable :deep(button) {
  text-decoration: underline dotted transparent;
  text-underline-offset: 0.2em;
  transition: color 150ms ease, text-decoration-color 150ms ease;
}

.qs-shipment-storage-card__copyable :deep(button:hover),
.qs-shipment-storage-card__copyable :deep(button:focus-visible) {
  color: oklch(var(--primary));
  text-decoration-color: currentcolor;
}

@container (width < 33rem) {
  .qs-shipment-storage-card__location {
    width: 100%;
    margin-left: 0;
  }

  .qs-shipment-storage-card__product-cost,
  .qs-shipment-storage-card__facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .qs-shipment-storage-card__cost {
    padding: 0.75rem 0 0;
    border-top: 1px solid oklch(var(--border));
    border-left: 0;
  }

  .qs-shipment-storage-card__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .qs-shipment-storage-card__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

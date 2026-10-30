<script setup lang="ts">
import type { QsShipmentStorageCardProps } from './types'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
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

const productSummary = computed(() => resolveStorageCardProducts(props.record.lineSummary))
const firstProduct = computed(() => productSummary.value.product)
const location = computed(() => resolveStorageCardLocation(props.record))
const shippingMark = computed(() => props.record.shippingMarkText?.trim() || null)
const containerMarks = computed(() => resolveStorageCardMarks(props.record.containerMarks))
const canCopyContainerMarks = computed(() => containerMarks.value.fullText !== '—')
const applyDisabled = computed(() => props.applyDisabledReason !== null)
const shipmentCardId = computed(() => `shipment-card-${props.record.id}`)
const shipmentLabel = computed(() => props.record.shipmentNo ?? '寄仓记录')
const detailLabel = computed(() => `${shipmentLabel.value}：详情`)
const applyLabel = computed(() => `${shipmentLabel.value}：申请调货`)
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
        <span :id="shipmentCardId" class="qs-type-data-emphasis inline-flex gap-1 min-w-0 items-center">
          <span class="truncate">{{ shipmentLabel }}</span>
          <CopyCellButton
            v-if="record.shipmentNo"
            always-visible
            label="货件编号"
            :text="record.shipmentNo ?? ''"
          />
        </span>
        <span class="qs-shipment-storage-card__location text-xs text-muted-foreground flex flex-wrap gap-2 min-w-0 items-center">
          <span class="text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{{ location.scope }}</span>
          <span class="inline-flex gap-1 min-w-0 items-center">
            <FaIcon name="i-lucide:map-pin" class="shrink-0 size-3.5" aria-hidden="true" />
            <span class="break-words">{{ location.warehouse }}</span>
          </span>
        </span>
      </div>
      <div class="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span>
          转入寄仓
          <DateTimeDisplay :value="record.createdAt" class="text-foreground" />
        </span>
        <span>原单客户 <span class="text-foreground">{{ record.originCustomerName }}</span></span>
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
              <span class="text-xs text-sky-700 font-mono px-1.5 py-0.5 rounded bg-sky-500/10 self-start">
                {{ firstProduct.productNo || '—' }}
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
              只有 <strong class="text-foreground font-medium">1 项产品</strong>，可在详情中查看
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

      <div class="qs-shipment-storage-card__info">
        <section class="p-3 border border-border rounded-lg min-w-0" aria-label="唛头">
          <div class="qs-shipment-storage-card__info-row">
            <span class="text-xs text-muted-foreground">货件唛头</span>
            <div class="flex flex-nowrap gap-1 min-w-0 items-center">
              <span v-if="shippingMark" class="text-xs break-all">{{ shippingMark }}</span>
              <span v-else class="text-xs">—</span>
              <CopyCellButton
                v-if="shippingMark"
                always-visible
                label="货件唛头"
                :text="shippingMark ?? ''"
              />
            </div>
          </div>
          <div class="qs-shipment-storage-card__info-row">
            <span class="text-xs text-muted-foreground">装柜唛头</span>
            <div class="flex flex-nowrap gap-1 min-w-0 items-center">
              <FaTooltip v-if="canCopyContainerMarks" :text="containerMarks.fullText" :delay="300">
                <span class="text-xs break-all">{{ containerMarks.visibleText }}<span v-if="containerMarks.hiddenCount > 0" class="whitespace-nowrap"> +{{ containerMarks.hiddenCount }}</span></span>
              </FaTooltip>
              <span v-else class="text-xs">—</span>
              <CopyCellButton
                v-if="canCopyContainerMarks"
                always-visible
                label="装柜唛头"
                :text="containerMarks.fullText"
              />
            </div>
          </div>
        </section>

        <section class="p-3 border border-border rounded-lg min-w-0" aria-label="来源单据">
          <div class="qs-shipment-storage-card__info-row">
            <span class="text-xs text-muted-foreground">来源销售单</span>
            <div class="flex flex-col gap-1 min-w-0">
              <QsPersonDisplay
                v-if="record.originIssuer"
                :display-name="record.originIssuer.displayName"
                :avatar-url="record.originIssuer.avatarUrl"
                size="sm"
              />
              <span v-else class="text-xs text-muted-foreground">—</span>
              <span class="flex gap-1 min-w-0 items-center">
                <span class="text-xs font-mono truncate">{{ record.originSalesOrderNo }}</span>
                <CopyCellButton always-visible label="销售单号" :text="record.originSalesOrderNo" />
              </span>
            </div>
          </div>
          <div class="qs-shipment-storage-card__info-row">
            <span class="text-xs text-muted-foreground">来源采购单</span>
            <div class="flex flex-col gap-1 min-w-0">
              <QsPersonDisplay
                v-if="record.originPurchaseCreator"
                :display-name="record.originPurchaseCreator.displayName"
                :avatar-url="record.originPurchaseCreator.avatarUrl"
                size="sm"
              />
              <span v-else class="text-xs text-muted-foreground">—</span>
              <span class="flex gap-1 min-w-0 items-center">
                <span class="text-xs font-mono truncate">{{ record.originPurchaseOrderNo }}</span>
                <CopyCellButton always-visible label="采购单号" :text="record.originPurchaseOrderNo" />
              </span>
            </div>
          </div>
        </section>
      </div>
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

.qs-shipment-storage-card__info {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 0.75rem;
}

.qs-shipment-storage-card__info-row {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr);
  gap: 0.5rem;
  align-items: start;
}

.qs-shipment-storage-card__info-row + .qs-shipment-storage-card__info-row {
  padding-top: 0.5rem;
  margin-top: 0.5rem;
  border-top: 1px solid oklch(var(--border));
}

@container (width < 33rem) {
  .qs-shipment-storage-card__location {
    width: 100%;
    margin-left: 0;
  }

  .qs-shipment-storage-card__product-cost,
  .qs-shipment-storage-card__info {
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

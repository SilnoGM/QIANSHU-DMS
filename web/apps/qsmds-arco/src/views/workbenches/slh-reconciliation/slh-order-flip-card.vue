<script setup lang="ts">
import type { SlhReconciliationOrderSection } from './detail.logic'
import type { SlhReconciliationTransferRecordDto } from '@/api/generated/types.gen'
import SlhOrderSection from './slh-order-section.vue'
import SlhTransferRecord from './slh-transfer-record.vue'

/**
 * 调货行的双面卡片：正面是当前销售单 + 调货记录，背面是原销售单 + 采购信息。
 *
 * 顶栏标题和底部完整寄仓入口不参与翻转，保证正反面都看得到当前面与完整记录入口；
 * 两面用 grid 叠在同一格，卡片高度取两面最大值，翻转时不会跳高。
 */
defineOptions({ name: 'SlhOrderFlipCard' })

const props = defineProps<{
  readonly frontSales: SlhReconciliationOrderSection
  readonly backSales: SlhReconciliationOrderSection
  readonly purchase: SlhReconciliationOrderSection
  readonly transfer: SlhReconciliationTransferRecordDto | null
  readonly originOrderNo: string | null
  readonly currentOrderNo: string | null
}>()

const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const flipped = ref(false)

const faceTitleKey = computed(() => flipped.value
  ? 'slhReconciliation.detail.flip.originTitle'
  : 'slhReconciliation.detail.flip.currentTitle')
const flipLabelKey = computed(() => flipped.value
  ? 'slhReconciliation.detail.flip.backToCurrent'
  : 'slhReconciliation.detail.flip.showOrigin')
const announceKey = computed(() => flipped.value
  ? 'slhReconciliation.detail.flip.announceOrigin'
  : 'slhReconciliation.detail.flip.announceCurrent')
const storageHref = computed(() => props.transfer === null
  ? null
  : router.resolve({
    name: 'qsOperationsGoodsStorage',
    query: { storageId: props.transfer.storageRecordId },
  }).href)
const canViewStorage = computed(() => auth('shipment-storage:read'))

function toggle(): void {
  flipped.value = !flipped.value
}
</script>

<template>
  <FaPageMain class="m-0 min-w-0">
    <div class="flex flex-wrap gap-3 min-w-0 items-center justify-between">
      <div class="flex gap-2 min-w-0 items-center">
        <span class="rounded-full bg-primary shrink-0 h-4.5 w-1" aria-hidden="true" />
        <span class="qs-type-section-title truncate">{{ t(faceTitleKey) }}</span>
      </div>
      <button
        type="button"
        class="text-muted-foreground border border-border rounded-full bg-background flex shrink-0 size-11 transition-colors items-center justify-center hover:text-foreground focus-visible:outline-none hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/40"
        :aria-label="t(flipLabelKey)"
        :aria-pressed="flipped"
        :title="t(flipLabelKey)"
        @click="toggle"
      >
        <FaIcon name="i-mdi:flip-horizontal" class="size-5" aria-hidden="true" />
      </button>
    </div>

    <p class="sr-only" aria-live="polite">
      {{ t(announceKey) }}
    </p>

    <div class="mt-3 min-w-0 [perspective:1200px] relative">
      <div
        class="grid transition-transform duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transition-none"
        :class="flipped ? '[transform:rotateY(180deg)]' : ''"
      >
        <div
          class="min-w-0 [backface-visibility:hidden] [grid-area:1/1]"
          :aria-hidden="flipped ? 'true' : undefined"
          :inert="flipped ? true : undefined"
        >
          <SlhOrderSection :section="frontSales" />
          <div class="my-3 border-t border-border" aria-hidden="true" />
          <SlhTransferRecord
            v-if="transfer"
            :transfer="transfer"
            :origin-order-no="originOrderNo"
            :current-order-no="currentOrderNo"
          />
          <p v-else class="qs-type-meta text-muted-foreground m-0 mt-3">
            {{ t('slhReconciliation.detail.transfer.noStorageRecord') }}
          </p>
        </div>

        <div
          class="min-w-0 [backface-visibility:hidden] [grid-area:1/1] [transform:rotateY(180deg)]"
          :aria-hidden="!flipped ? 'true' : undefined"
          :inert="!flipped ? true : undefined"
        >
          <SlhOrderSection :section="backSales" />
          <div class="my-3 border-t border-border" aria-hidden="true" />
          <SlhOrderSection :section="purchase" />
        </div>
      </div>
    </div>

    <div class="mt-3 pt-3 border-t border-border min-w-0">
      <a
        v-if="canViewStorage && storageHref !== null"
        :href="storageHref"
        target="_blank"
        rel="noopener noreferrer"
        class="text-sm text-primary font-medium inline-flex gap-1 items-center hover:underline"
      >
        <FaIcon name="i-lucide:external-link" class="size-4" aria-hidden="true" />
        {{ t('slhReconciliation.detail.transfer.viewFullStorageRecord') }}
      </a>
      <span
        v-else
        class="text-sm text-muted-foreground inline-flex gap-1 cursor-not-allowed items-center"
        :title="t(transfer === null
          ? 'slhReconciliation.detail.transfer.noStorageRecord'
          : 'slhReconciliation.detail.transfer.storagePermissionRequired')"
      >
        <FaIcon name="i-lucide:external-link" class="size-4" aria-hidden="true" />
        {{ t('slhReconciliation.detail.transfer.viewFullStorageRecord') }}
      </span>
    </div>
  </FaPageMain>
</template>

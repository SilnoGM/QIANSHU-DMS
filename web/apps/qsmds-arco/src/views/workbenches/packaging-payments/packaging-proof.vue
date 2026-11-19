<script setup lang="ts">
import type { PackagingCostRequestDto } from '@/api/generated/types.gen'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

const props = defineProps<{ record: PackagingCostRequestDto, includePayment?: boolean }>()
const { t } = useI18n()
type ProofKind = 'PACKAGING' | 'QUOTATION' | 'PAYMENT'
// 付款截图只在已付款且凭证存在时出现；运营页需要它作为「到底付没付」的证据，财务页保持原样。
const groups = computed<ProofKind[]>(() => {
  const kinds: ProofKind[] = ['PACKAGING', 'QUOTATION']
  if (props.includePayment && props.record.status === 'PAID' && props.record.paymentReceipt?.voucher) {
    kinds.push('PAYMENT')
  }
  return kinds
})
function image(record: PackagingCostRequestDto, kind: ProofKind) {
  const asset = kind === 'PACKAGING'
    ? record.packagingImage
    : kind === 'QUOTATION' ? record.quotationImage : record.paymentReceipt?.voucher
  return [{ key: `${kind}-${asset?.mediaAssetId ?? record.id}`, src: `/api/packaging-cost-requests/${encodeURIComponent(record.id)}/images/${kind}`, alt: t(`packagingPayment.images.${kind}`), tooltip: t(`packagingPayment.images.${kind}`) }]
}
</script>

<template>
  <div class="flex gap-4 items-start">
    <div v-for="kind in groups" :key="kind" class="space-y-1">
      <ImageGroup :items="image(record, kind)" :max-count="1" :size="40" fit="contain" />
      <p class="qs-type-meta text-muted-foreground m-0">
        {{ t(`packagingPayment.imageShort.${kind}`) }}
      </p>
    </div>
  </div>
</template>

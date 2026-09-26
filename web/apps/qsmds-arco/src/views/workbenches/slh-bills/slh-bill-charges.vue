<script setup lang="ts">
import type { SlhBillLineChargeDto } from '@/api/generated/types.gen'
import { groupSlhBillCharges } from './display.logic'

defineOptions({ name: 'SlhBillCharges' })
const props = defineProps<{ charges: SlhBillLineChargeDto[] }>()
const { t } = useI18n()
const groups = computed(() => groupSlhBillCharges(props.charges))
</script>

<template>
  <div v-if="!groups.length" class="qs-type-meta text-muted-foreground">
    —
  </div>
  <div v-else class="space-y-1">
    <!-- 币种分行、费别逐个列出，避免把人民币与台币费用混成一个合计。 -->
    <div v-for="group in groups" :key="group.currencyCode" class="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
      <span class="qs-type-meta text-muted-foreground">{{ group.currencyCode }}</span>
      <span v-for="(charge, index) in group.items" :key="`${charge.chargeType}-${index}`" class="qs-type-data whitespace-nowrap">
        {{ t(`slhBill.chargeType.${charge.chargeType}`) }} {{ charge.amount }}
      </span>
    </div>
  </div>
</template>

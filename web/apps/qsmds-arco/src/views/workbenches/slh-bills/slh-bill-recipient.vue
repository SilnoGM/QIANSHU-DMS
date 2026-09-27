<script setup lang="ts">
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'

defineOptions({ name: 'SlhBillRecipient' })
/**
 * 明细表「收货人信息」单元格：第一行姓名 + 电话，第二行地址。
 *
 * 三个字段来自服务端的拆分结果；缺项不占位（不渲染空行），三项都缺时由调用方显示缺值占位符。
 */
defineProps<{
  name: string | null
  phones: string | null
  address: string | null
}>()

const { t } = useI18n()
</script>

<template>
  <QsTableStackedCell>
    <QsTableStackedLine v-if="name || phones">
      <span class="qs-type-data-emphasis">{{ name || t('slhBill.valueMissing') }}</span>
      <span v-if="phones" class="qs-type-data ml-2">{{ phones }}</span>
    </QsTableStackedLine>
    <QsTableStackedLine v-if="address" tone="muted">
      {{ address }}
    </QsTableStackedLine>
    <QsTableStackedLine v-if="!name && !phones && !address">
      {{ t('slhBill.valueMissing') }}
    </QsTableStackedLine>
  </QsTableStackedCell>
</template>

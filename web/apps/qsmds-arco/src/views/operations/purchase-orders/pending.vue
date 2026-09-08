<script setup lang="ts">
import PurchaseOrderListPage from './index.vue'

defineOptions({ name: 'QsOperationsPendingPurchaseOrders' })
</script>

<template>
  <PurchaseOrderListPage view-mode="pending" />
</template>

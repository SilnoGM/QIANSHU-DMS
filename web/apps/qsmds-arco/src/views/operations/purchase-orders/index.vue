<script setup lang="ts">
defineOptions({ name: 'OperationsPurchaseOrders' })

const router = useRouter()

function navigateToCreate(): void {
  void router.push({ name: 'operationsPurchaseOrderCreate' })
}
</script>

<template>
  <FaPageMain>
    <FaButton @click="navigateToCreate">
      新增采购订单
    </FaButton>
  </FaPageMain>
</template>

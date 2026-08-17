<script setup lang="ts">
defineOptions({ name: 'OperationsSalesOrders' })

const router = useRouter()

function navigateToCreate(): void {
  void router.push({ name: 'operationsSalesOrderCreate' })
}
</script>

<template>
  <FaPageMain>
    <FaButton @click="navigateToCreate">
      新增销售订单
    </FaButton>
  </FaPageMain>
</template>

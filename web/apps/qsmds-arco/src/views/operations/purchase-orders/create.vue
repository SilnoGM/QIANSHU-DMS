<script setup lang="ts">
defineOptions({ name: 'OperationsPurchaseOrderCreate' })

const router = useRouter()

function navigateBack(): void {
  void router.push({ name: 'operationsPurchaseOrders' })
}
</script>

<template>
  <FaPageMain>
    <FaButton variant="outline" @click="navigateBack">
      返回
    </FaButton>
  </FaPageMain>
</template>

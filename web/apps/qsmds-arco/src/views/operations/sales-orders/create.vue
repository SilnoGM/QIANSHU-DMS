<script setup lang="ts">
defineOptions({ name: 'OperationsSalesOrderCreate' })

const router = useRouter()

function navigateBack(): void {
  void router.push({ name: 'operationsSalesOrders' })
}
</script>

<template>
  <FaPageMain>
    <FaButton variant="outline" @click="navigateBack">
      返回
    </FaButton>
  </FaPageMain>
</template>

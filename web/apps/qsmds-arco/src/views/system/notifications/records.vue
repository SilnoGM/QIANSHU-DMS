<script setup lang="ts">
import OverviewPanel from './overview-panel.vue'
import RecordsPanel from './records-panel.vue'

defineOptions({ name: 'SystemNotificationRecords' })
</script>

<template>
  <FaPageHeader
    title="通知记录"
    description="查看通知概览、近 24 小时状态与发送记录。"
  />
  <FaPageMain>
    <div class="flex flex-col gap-8">
      <section class="flex flex-col gap-3">
        <h2 class="qs-type-body-medium m-0">
          概览
        </h2>
        <OverviewPanel />
      </section>
      <section class="flex flex-col gap-3">
        <h2 class="qs-type-body-medium m-0">
          发送记录
        </h2>
        <RecordsPanel />
      </section>
    </div>
  </FaPageMain>
</template>

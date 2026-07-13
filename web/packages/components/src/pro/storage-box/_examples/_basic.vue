<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import FaStorageBox from '../index.vue'

const profile = reactive({
  view: 'compact',
  columns: ['姓名', '部门', '状态'],
})

const restoredText = shallowRef('暂无取出的数据')

function handleTakeOut(content: object | any[]) {
  if (Array.isArray(content)) {
    return
  }

  Object.assign(profile, content)
  restoredText.value = JSON.stringify(content, null, 2)
}
</script>

<template>
  <div class="space-y-4">
    <div class="text-sm text-muted-foreground px-4 py-3 rounded-md bg-muted">
      当前数据：{{ profile.view }} / {{ profile.columns.join('、') }}
    </div>
    <FaStorageBox
      unique-key="storage-box-example"
      box-id="basic"
      :data="profile"
      @take-out="handleTakeOut"
    />
    <pre class="text-xs text-muted-foreground p-3 rounded-md bg-muted whitespace-pre-wrap">{{ restoredText }}</pre>
  </div>
</template>

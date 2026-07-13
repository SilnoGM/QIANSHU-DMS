<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import FaButton from '../../../basic/button/index.vue'
import FaCheckbox from '../../../basic/checkbox/index.vue'
import FaInput from '../../../basic/input/index.vue'
import FaSelect from '../../../basic/select/index.vue'
import FaStorageBox from '../index.vue'

const departmentOptions = [
  { label: '技术部', value: 'tech' },
  { label: '设计部', value: 'design' },
  { label: '运营部', value: 'operation' },
]

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' },
]

const filters = reactive({
  keyword: '',
  department: 'tech',
  status: 'all',
  onlyMine: false,
})

const message = shallowRef('调整筛选项后，可以保存为常用筛选。')

function search() {
  message.value = `已模拟筛选：${filters.keyword || '全部关键字'}`
}

function recover(content: object | any[]) {
  if (Array.isArray(content)) {
    return
  }

  Object.assign(filters, content)
  search()
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap gap-3 items-center">
      <FaInput v-model="filters.keyword" placeholder="姓名 / 手机号" class="w-45" />
      <FaSelect v-model="filters.department" :options="departmentOptions" class="w-35" />
      <FaSelect v-model="filters.status" :options="statusOptions" class="w-30" />
      <FaCheckbox v-model="filters.onlyMine">
        只看我负责的
      </FaCheckbox>
      <FaButton @click="search">
        筛选
      </FaButton>
      <FaStorageBox
        unique-key="storage-box-example"
        box-id="filter"
        title="常用筛选"
        :data="filters"
        @take-out="recover"
      >
        <FaButton variant="outline">
          保存当前筛选
        </FaButton>
      </FaStorageBox>
    </div>
    <div class="text-sm text-muted-foreground px-4 py-3 rounded-md bg-muted">
      {{ message }}
    </div>
  </div>
</template>

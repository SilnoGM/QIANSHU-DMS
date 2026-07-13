<script setup lang="ts">
import type { TableColumn } from '@fantastic-admin/components'

interface ErrorLogInfo {
  err: {
    message: string
    stack: string
  }
  info: string
  url: string
  datetime: string
}

const appSettingsStore = useAppSettingsStore()

const env = import.meta.env.MODE

const errorLog = ref('')

const errorLogInfo = computed(() => {
  return errorLog.value ? [JSON.parse(errorLog.value) as ErrorLogInfo] : []
})

const tableColumns: TableColumn<ErrorLogInfo>[] = [
  {
    accessorKey: 'info',
    header: '错误信息',
    width: 200,
    align: 'center',
  },
  {
    accessorKey: 'err',
    header: '错误详情',
  },
  {
    accessorKey: 'url',
    header: '错误链接',
    width: 200,
    align: 'center',
  },
  {
    accessorKey: 'datetime',
    header: '时间',
    width: 200,
    align: 'center',
  },
]

function bugTest(type: any) {
  nextTick(() => {
    errorLog.value = sessionStorage.getItem('errorLog') || ''
  })
  switch (type) {
    case 1:
      // @ts-expect-error: ignore
      a = abc
      break
    case 2:
      // @ts-expect-error: ignore
      testMethod()
      break
  }
}
function open(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div>
    <FaPageHeader title="错误日志" description="错误日志通过 Vue 提供的全局错误钩子 errorHandler 进行拦截，如果需要上报给后端，需自行实现">
      <FaButton variant="outline" @click="open('https://cn.vuejs.org/api/application.html#app-config-errorhandler')">
        <FaIcon name="i-ep:link" />
        Vue errorHandler 说明
      </FaButton>
    </FaPageHeader>
    <FaPageMain>
      <div v-if="env !== 'development'">
        <div v-if="!appSettingsStore.settings.app.errorLog">
          请到 /src/settings.ts 里打开错误日志功能，再进入该页面查看演示
        </div>
        <div v-else class="space-y-2">
          <div class="space-x-2">
            <FaButton variant="destructive" @click="bugTest(1)">
              模拟触发错误1
            </FaButton>
            <FaButton variant="destructive" @click="bugTest(2)">
              模拟触发错误2
            </FaButton>
          </div>
          <FaTable :data="errorLogInfo" :columns="tableColumns" border>
            <template #cell-info="{ row }">
              <div>{{ row.original.err.message }}</div>
              <FaTag variant="destructive">
                {{ row.original.info }}
              </FaTag>
            </template>
            <template #cell-err="{ row }">
              <div class="whitespace-pre-wrap">
                {{ row.original.err.stack }}
              </div>
            </template>
            <template #cell-url="{ value }">
              <FaButton variant="link" as="a" :href="value as string" target="_blank">
                {{ value }}
              </FaButton>
            </template>
          </FaTable>
        </div>
      </div>
      <div v-else>
        errorHandler 只在生产环境中生效，所以开发环境无法演示
      </div>
    </FaPageMain>
  </div>
</template>

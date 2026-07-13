<i18n lang="yaml">
zh-cn:
  print: 打印
  json: JSON数据
  image: 图片
zh-tw:
  print: 列印
  json: JSON
  image: 圖片
en:
  print: Print
  json: JSON
  image: Image
</i18n>

<script setup lang="ts">
import printJS from 'print-js'
import img from '@/assets/images/login-banner.png'
import Alert from './components/alert.vue'
import Command from './components/command.vue'

const { t } = useI18n()

const jsonData = ref([
  {
    date: '2016-05-02',
    name: 'John Doe',
    address: 'New York No. 1 Lake Park',
  },
  {
    date: '2016-05-04',
    name: 'Jim Green',
    address: 'London No. 1 Lake Park',
  },
  {
    date: '2016-05-01',
    name: 'Joe Black',
    address: 'Sidney No. 1 Lake Park',
  },
  {
    date: '2016-05-03',
    name: 'Jim Green',
    address: 'London No. 1 Lake Park',
  },
])

function print(type: 'json' | 'image') {
  if (type === 'json') {
    printJS({
      printable: jsonData.value,
      properties: ['date', 'name', 'address'],
      type: 'json',
      gridHeaderStyle: 'color: red; border: 1px solid #3971A5;',
      gridStyle: 'border: 1px solid #3971A5;',
    })
  }
  else if (type === 'image') {
    printJS({
      printable: [
        img,
        img,
      ],
      type: 'image',
      imageStyle: 'width: 50%; margin-bottom: 20px;',
    })
  }
}
function open(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div>
    <Alert />
    <FaPageHeader title="打印">
      <template #description>
        <Command text="pnpm add print-js" />
      </template>
      <FaButton variant="outline" size="icon" @click="open('https://github.com/crabbly/print.js')">
        <FaIcon name="i-simple-icons:github" />
      </FaButton>
    </FaPageHeader>
    <FaPageMain :title="t('json')">
      <div class="space-y-2">
        <FaCode :code="JSON.stringify(jsonData, null, 2)" />
        <FaButton @click="print('json')">
          {{ t('print') }}
        </FaButton>
      </div>
    </FaPageMain>
    <FaPageMain :title="t('image')">
      <FaButton @click="print('image')">
        {{ t('print') }}
      </FaButton>
    </FaPageMain>
  </div>
</template>

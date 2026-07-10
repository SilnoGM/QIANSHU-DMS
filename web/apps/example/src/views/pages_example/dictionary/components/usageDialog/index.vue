<script setup lang="ts">
import type { DictionaryItem } from '@/store/modules/dictionary'

const visible = defineModel<boolean>({
  default: false,
})

const keyList = [
  { label: '证件', value: 'user_card' },
  { label: '学历', value: 'user_education' },
]
const key = ref('')

const dictionaryStore = useDictionaryStore()

const dictionary = ref<DictionaryItem[]>([])

async function onChange(val: string) {
  dictionary.value = await dictionaryStore.get(val)
}
</script>

<template>
  <FaModal
    v-model="visible"
    title="使用示例"
    class="w-[400px]"
    :show-confirm-button="false"
    :close-on-click-overlay="false"
    :footer="false"
    @closed="visible = false"
  >
    <div class="flex flex-col gap-4">
      <div class="text-sm text-muted-foreground px-4 py-3 border rounded-md">
        如果全局状态中没有该字典，则会请求接口获取并存储在全局状态中。
      </div>
      <FaSelect v-model="key" :options="keyList" placeholder="请选择" class="w-full" @change="(val) => val && onChange(val as string)" />
      <p class="text-sm break-all">
        {{ dictionary }}
      </p>
      <hr class="my-1">
      <p class="text-sm text-muted-foreground">
        根据value获取name:
      </p>
      <p class="text-sm">
        {{ dictionaryStore.getName('user_card', '1') }}
      </p>
      <hr class="my-1">
      <p class="text-sm text-muted-foreground">
        根据name获取value:
      </p>
      <p class="text-sm">
        {{ dictionaryStore.getValue('user_card', '居民身份证') }}
      </p>
    </div>
  </FaModal>
</template>

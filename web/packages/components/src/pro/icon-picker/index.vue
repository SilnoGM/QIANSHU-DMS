<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Button from '../../basic/button/index.vue'
import Icon from '../../basic/icon/index.vue'
import Input from '../../basic/input/index.vue'
import Pagination from '../../basic/pagination/index.vue'
import Popover from '../../basic/popover/index.vue'
import ScrollArea from '../../basic/scroll-area/index.vue'

export interface IconPickerCollection {
  prefix: string
  info: {
    name: string
    total: number
  }
  icons: string[]
}

defineOptions({
  name: 'BuiltInIconPicker',
})

const props = withDefaults(defineProps<{
  icons?: IconPickerCollection[]
}>(), {
  icons: () => [],
})

const value = defineModel<string>({
  default: '',
})

const open = ref(false)
const activeName = ref('')
const search = ref('')
const pagination = ref({
  page: 1,
  pageSize: 48,
})

const collections = computed(() => props.icons)
const selectedPrefix = computed(() => value.value.split(':')[0])
const activeCollection = computed(() => collections.value.find(item => item.prefix === activeName.value))

watch([collections, selectedPrefix], ([currentCollections, currentPrefix]) => {
  if (currentCollections.length === 0) {
    activeName.value = ''
    return
  }
  const nextActiveName = currentCollections.some(item => item.prefix === currentPrefix)
    ? currentPrefix
    : currentCollections[0].prefix
  if (!activeName.value || !currentCollections.some(item => item.prefix === activeName.value)) {
    activeName.value = nextActiveName
  }
}, {
  immediate: true,
})

const iconList = computed(() => {
  let iconsFilter = activeCollection.value?.icons ?? []
  if (search.value) {
    iconsFilter = iconsFilter.filter((item) => {
      return item.includes(search.value)
    })
  }
  return iconsFilter
})
const currentIconList = computed(() => {
  return iconList.value.slice(
    (pagination.value.page - 1) * pagination.value.pageSize,
    (pagination.value.page - 1) * pagination.value.pageSize + pagination.value.pageSize,
  )
})

function handleTabChange(name: string) {
  activeName.value = name
  pagination.value.page = 1
}

function chooseIcon(val: string) {
  value.value = val
  open.value = false
}
function removeIcon() {
  value.value = ''
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open" :collision-padding="5" class="p-0">
    <slot :icon="value">
      <Button variant="outline" size="icon" class="[&_svg]:size-inherit">
        <Icon :name="value !== '' ? value : 'i-whh:googleplusold'" class="size-4" :class="{ 'opacity-20': value === '' }" />
      </Button>
    </slot>
    <template #panel>
      <div class="rounded-md flex-center h-500px w-600px of-hidden">
        <ScrollArea v-if="collections.length > 0" :scrollbar="false" mask class="border-e shrink-0 h-full w-150px">
          <div v-for="item in collections" :key="item.prefix" class="px-4 py-3 border-b cursor-pointer transition-background-color space-y-1 last:border-b-none hover-bg-accent/50" :class="{ 'bg-accent hover-bg-accent!': item.prefix === activeName }" @click="handleTabChange(item.prefix)">
            <div class="text-base text-accent-foreground leading-tight">
              {{ item.info.name }}
            </div>
            <div class="text-xs text-accent-foreground/30">
              {{ item.info.total }} icons
            </div>
          </div>
        </ScrollArea>
        <div class="p-6 flex-col-center flex-1 h-full">
          <div v-if="collections.length === 0" class="text-muted-foreground flex-center h-full">
            <Icon name="i-tabler:mood-empty" class="opacity-30 size-12" />
          </div>
          <template v-else>
            <div class="search-bar">
              <Input v-model="search">
                <template #start>
                  <Icon name="i-ri:search-line" />
                </template>
              </Input>
            </div>
            <div class="my-2 flex-1 gap-1 grid grid-cols-7 grid-rows-7 w-full place-items-center">
              <Button variant="outline" size="icon" class="h-12 w-12" @click="removeIcon">
                <Icon name="i-ep:delete" class="opacity-20 size-6" />
              </Button>
              <Button v-for="(icon, index) in currentIconList" :key="index" variant="ghost" size="icon" class="h-12 w-12 [&_svg]:size-inherit" @click="chooseIcon(`${activeName}:${icon}`)">
                <Icon :name="`${activeName}:${icon}`" class="size-6" />
              </Button>
            </div>
            <Pagination v-model:page="pagination.page" :size="pagination.pageSize" :total="iconList.length" layout="pager" />
          </template>
        </div>
      </div>
    </template>
  </Popover>
</template>

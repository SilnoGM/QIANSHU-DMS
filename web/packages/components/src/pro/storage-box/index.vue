<script setup lang="ts">
import type { SortableEvent } from 'sortablejs'
import type { VNode } from 'vue'
import Sortable from 'sortablejs'
import { onMounted, ref, useTemplateRef, watch } from 'vue'
import Button from '../../basic/button/index.vue'
import Icon from '../../basic/icon/index.vue'
import Input from '../../basic/input/index.vue'
import Popover from '../../basic/popover/index.vue'
import ScrollArea from '../../basic/scroll-area/index.vue'

defineOptions({
  name: 'BuiltInStorageBox',
})

const props = withDefaults(
  defineProps<{
    uniqueKey: string
    boxId: string
    data: object | any[]
    title?: string
  }>(),
  {
    title: '储物箱',
  },
)

const emits = defineEmits<{
  takeOut: [value: object | any[]]
}>()

const slots = defineSlots<{
  default?: () => VNode
}>()

const open = ref(false)
const isAdding = ref(false)
const storageName = ref('')
const storageNameInvalid = ref(false)

const list = ref<{
  title: string
  content: string
}[]>([])

onMounted(() => {
  recoveryStorage()
})

watch(open, (value) => {
  if (!value) {
    onCancelAdd()
  }
})

watch(storageName, (value) => {
  if (value.trim()) {
    storageNameInvalid.value = false
  }
})

function onShowAdd() {
  isAdding.value = true
}

function onAdd() {
  const name = storageName.value.trim()
  if (!name) {
    storageNameInvalid.value = true
    return
  }

  list.value.push({
    title: name,
    content: JSON.stringify(props.data),
  })
  updateStorage()
  onCancelAdd()
}

function onCancelAdd() {
  isAdding.value = false
  storageName.value = ''
  storageNameInvalid.value = false
}

function onGet(content: string) {
  open.value = false
  emits('takeOut', JSON.parse(content))
}

function onRemove(index: number) {
  list.value.splice(index, 1)
  updateStorage()
}

function sortStorage(newIndex: number, oldIndex: number) {
  list.value.splice(newIndex, 0, list.value.splice(oldIndex, 1)[0])
  updateStorage()
}

function updateStorage() {
  const storageBoxData = localStorage.has(`storageBoxData_${props.uniqueKey}`) ? JSON.parse(localStorage.getItem(`storageBoxData_${props.uniqueKey}`) as string) : {}
  storageBoxData[props.boxId] = list.value
  localStorage.setItem(`storageBoxData_${props.uniqueKey}`, JSON.stringify(storageBoxData))
}

function recoveryStorage() {
  if (localStorage.has(`storageBoxData_${props.uniqueKey}`)) {
    const storageBoxData = JSON.parse(localStorage.getItem(`storageBoxData_${props.uniqueKey}`) as string)
    if (storageBoxData[props.boxId]) {
      list.value = storageBoxData[props.boxId]
    }
  }
}

const containerRef = useTemplateRef('containerRef')

watch(() => containerRef.value, (val) => {
  if (val) {
    // eslint-disable-next-line no-new
    new Sortable(val, {
      animation: 200,
      ghostClass: 'op-0',
      draggable: '.draggable-item',
      onUpdate: (e: SortableEvent) => {
        if (e.newIndex !== undefined && e.oldIndex !== undefined) {
          sortStorage(e.newIndex, e.oldIndex)
        }
      },
    })
  }
})
</script>

<template>
  <Popover v-model:open="open" class="p-0">
    <slot v-if="!!slots.default" />
    <Button v-else variant="ghost" size="icon">
      <Icon name="i-ep:message-box" class="size-4" />
    </Button>
    <template #panel>
      <div class="w-80">
        <div class="px-4 py-3 flex items-center justify-between">
          <div class="text-sm font-bold">
            {{ title }}
          </div>
          <Icon
            :name="isAdding ? 'i-ep:arrow-left' : 'i-ep:plus'"
            class="text-base cursor-pointer"
            @click="isAdding ? onCancelAdd() : onShowAdd()"
          />
        </div>
        <div v-if="isAdding" class="px-4 pb-4">
          <Input v-model="storageName" :aria-invalid="storageNameInvalid || undefined" class="w-full!" end-class="pe-1" @keyup.enter="onAdd">
            <template #end>
              <Button variant="ghost" size="icon-sm" class="me-2 size-6" @click="onAdd">
                <Icon name="i-lucide:check" class="size-4" />
              </Button>
            </template>
          </Input>
        </div>
        <ScrollArea v-else class="max-h-200px">
          <div v-if="list.length > 0" ref="containerRef" class="px-4 pb-4 flex flex-wrap gap-2 items-center justify-between">
            <div v-for="(item, index) in list" :key="`${index}_${item.title}`" :title="item.title" class="group draggable-item px-2 py-2 rounded-lg flex gap-1 w-[calc(50%-0.25rem)] cursor-pointer ring-1 ring-border ring-inset items-center relative hover-bg-accent" @click="onGet(item.content)">
              <div class="text-sm pe-4 flex-1 truncate group-hover:[mask-image:linear-gradient(90deg,#000_calc(100%-80px),transparent)]">
                {{ item.title }}
              </div>
              <div class="text-secondary-foreground rounded-full h-5 w-5 hidden right-2 absolute hover:(bg-secondary ring-1) group-hover:flex-center">
                <Icon name="i-ep:delete" class="size-3" @click.stop="onRemove(index)" />
              </div>
            </div>
          </div>
          <div v-else class="text-secondary-foreground pb-10 pt-6 flex-col-center">
            <Icon name="i-tabler:mood-empty" class="size-10" />
          </div>
        </ScrollArea>
      </div>
    </template>
  </Popover>
</template>

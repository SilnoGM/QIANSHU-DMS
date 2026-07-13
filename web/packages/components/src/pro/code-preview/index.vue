<script setup lang="ts">
import { ref } from 'vue'
import Button from '../../basic/button/index.vue'
import Icon from '../../basic/icon/index.vue'
import PageMain from '../../basic/page-main/index.vue'
import Code from '../code/index.vue'

defineOptions({
  name: 'BuiltInCodePreview',
})

defineProps<{
  code: string
  title?: string
}>()

const showSource = ref(false)
</script>

<template>
  <PageMain :title main-class="p-0">
    <div class="p-4">
      <slot />
    </div>
    <Code v-show="showSource" :code="code.trim()" class="rounded-none" />
    <div class="p-2 border-t">
      <Button variant="ghost" size="sm" class="w-full" @click="showSource = !showSource">
        <Icon :name="showSource ? 'i-lucide:code' : 'i-lucide:code-xml'" class="size-4" />
      </Button>
    </div>
  </PageMain>
</template>

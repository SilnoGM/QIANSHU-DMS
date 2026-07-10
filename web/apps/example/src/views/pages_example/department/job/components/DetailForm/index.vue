<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import { ref } from 'vue'
import apiJob from '@/api/modules/job'

export interface Props {
  id?: number | string
  departmentId?: number | string
}
const props = withDefaults(
  defineProps<Props>(),
  {
    id: '',
    departmentId: '',
  },
)

const loading = ref(false)
const formRef = useTemplateRef<FormExpose>('formRef')

interface DetailFormModel {
  id: number | string
  department_id: number | string
  title: string
}

const model = ref<DetailFormModel>({
  id: props.id,
  department_id: props.departmentId,
  title: '',
})

const validationSchema = {
  title(value: string) {
    return value.trim() ? true : '请输入职位名称'
  },
}

onMounted(() => {
  if (model.value.id !== '') {
    getInfo()
  }
})

function getInfo() {
  loading.value = true
  apiJob.detail({
    department_id: model.value.department_id,
    id: model.value.id,
  }).then((res) => {
    loading.value = false
    model.value.title = res.data.title
  }).catch(() => {
    loading.value = false
  })
}

async function submit() {
  const result = await formRef.value?.validate()

  if (!result?.valid) {
    return false
  }

  if (model.value.id === '') {
    await apiJob.create(model.value)
    useFaToast().success('模拟新增成功')
  }
  else {
    await apiJob.edit(model.value)
    useFaToast().success('模拟编辑成功')
  }

  return true
}

defineExpose({
  submit,
})
</script>

<template>
  <div v-loading="loading">
    <FaForm
      ref="formRef"
      :model="model"
      :validation-schema="validationSchema"
      label-placement="right"
      :label-width="120"
    >
      <FaFormItem name="title" label="职位" required>
        <FaInput placeholder="请输入职位名称" class="w-full" />
      </FaFormItem>
    </FaForm>
  </div>
</template>

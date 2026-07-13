<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaCheckbox from '../../../basic/checkbox/index.vue'
import FaInput from '../../../basic/input/index.vue'
import FaSelect from '../../../basic/select/index.vue'
import FaSmoothSwipe from '../index.vue'

const activeIndex = shallowRef(0)
const status = shallowRef('请填写基本信息')

const formData = reactive({
  name: '',
  email: '',
  company: '',
  position: '',
  department: '',
  agree: false,
  newsletter: false,
})

const departmentOptions = [
  { label: '技术部', value: '技术部' },
  { label: '产品部', value: '产品部' },
  { label: '设计部', value: '设计部' },
  { label: '运营部', value: '运营部' },
]

function validateCurrentStep() {
  if (activeIndex.value === 0) {
    return formData.name.trim() !== '' && formData.email.trim() !== ''
  }
  if (activeIndex.value === 1) {
    return formData.company.trim() !== '' && formData.position.trim() !== '' && formData.department !== ''
  }
  return formData.agree === true
}

function nextStep() {
  if (!validateCurrentStep()) {
    status.value = '请先补全当前步骤的必填信息'
    return
  }
  activeIndex.value = Math.min(activeIndex.value + 1, 2)
  status.value = activeIndex.value === 2 ? '请确认信息并提交' : '请继续填写详细信息'
}

function prevStep() {
  activeIndex.value = Math.max(activeIndex.value - 1, 0)
  status.value = '已返回上一步'
}

function submitForm() {
  if (!validateCurrentStep()) {
    status.value = '请先同意用户协议'
    return
  }
  status.value = '表单提交成功'
}

function resetForm() {
  formData.name = ''
  formData.email = ''
  formData.company = ''
  formData.position = ''
  formData.department = ''
  formData.agree = false
  formData.newsletter = false
  activeIndex.value = 0
  status.value = '请填写基本信息'
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <FaSmoothSwipe :active-index>
      <div class="px-2 pb-1 space-y-4">
        <h3 class="text-lg font-semibold text-center">
          基本信息
        </h3>
        <div class="gap-4 grid">
          <FaInput v-model="formData.name" placeholder="请输入您的姓名" class="w-full" />
          <FaInput v-model="formData.email" placeholder="请输入您的邮箱地址" class="w-full" />
        </div>
      </div>
      <div class="px-2 pb-1 space-y-4">
        <h3 class="text-lg font-semibold text-center">
          详细信息
        </h3>
        <div class="gap-4 grid">
          <FaInput v-model="formData.company" placeholder="请输入您的公司名称" class="w-full" />
          <FaInput v-model="formData.position" placeholder="请输入您的职位" class="w-full" />
          <FaSelect v-model="formData.department" :options="departmentOptions" placeholder="请选择您的部门" class="w-full" />
        </div>
      </div>
      <div class="px-2 pb-1 space-y-4">
        <h3 class="text-lg font-semibold text-center">
          确认信息
        </h3>
        <div class="mb-4 p-4 rounded-lg bg-muted/50 space-y-2">
          <div class="flex justify-between">
            <span class="text-muted-foreground">姓名：</span>
            <span class="font-medium">{{ formData.name || '未填写' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">邮箱：</span>
            <span class="font-medium">{{ formData.email || '未填写' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">公司名称：</span>
            <span class="font-medium">{{ formData.company || '未填写' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">职位：</span>
            <span class="font-medium">{{ formData.position || '未填写' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">部门：</span>
            <span class="font-medium">{{ formData.department || '未填写' }}</span>
          </div>
        </div>
        <div class="space-y-3">
          <FaCheckbox v-model="formData.agree">
            我已阅读并同意《用户协议》和《隐私政策》
          </FaCheckbox>
          <FaCheckbox v-model="formData.newsletter">
            订阅我们的新闻通讯，获取最新产品信息
          </FaCheckbox>
        </div>
      </div>
    </FaSmoothSwipe>

    <div class="mt-6 px-2 flex justify-between">
      <div class="flex gap-2">
        <FaButton v-if="activeIndex > 0" variant="outline" @click="prevStep">
          上一步
        </FaButton>
        <FaButton variant="outline" @click="resetForm">
          重置
        </FaButton>
      </div>
      <FaButton v-if="activeIndex < 2" @click="nextStep">
        下一步
      </FaButton>
      <FaButton v-else @click="submitForm">
        提交
      </FaButton>
    </div>
    <div class="text-sm text-muted-foreground mt-3 px-2">
      {{ status }}
    </div>
  </div>
</template>

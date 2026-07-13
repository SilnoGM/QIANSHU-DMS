import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import CustomTrigger from './_custom-trigger.vue'
import CustomTriggerRaw from './_custom-trigger.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '自定义触发容器',
    component: CustomTrigger,
    componentRaw: CustomTriggerRaw,
  },
]

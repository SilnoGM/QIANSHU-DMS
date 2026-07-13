import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import CustomItem from './_custom-item.vue'
import CustomItemRaw from './_custom-item.vue?raw'
import SingleLineTrigger from './_single-line-trigger.vue'
import SingleLineTriggerRaw from './_single-line-trigger.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '自定义候选项',
    component: CustomItem,
    componentRaw: CustomItemRaw,
  },
  {
    title: '单行输入与自定义触发词',
    component: SingleLineTrigger,
    componentRaw: SingleLineTriggerRaw,
  },
]

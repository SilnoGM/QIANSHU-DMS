import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Decimals from './_decimals.vue'
import DecimalsRaw from './_decimals.vue?raw'
import Duration from './_duration.vue'
import DurationRaw from './_duration.vue?raw'
import Manual from './_manual.vue'
import ManualRaw from './_manual.vue?raw'
import PrefixSuffix from './_prefix-suffix.vue'
import PrefixSuffixRaw from './_prefix-suffix.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '持续时间',
    component: Duration,
    componentRaw: DurationRaw,
  },
  {
    title: '小数',
    component: Decimals,
    componentRaw: DecimalsRaw,
  },
  {
    title: '前缀/后缀',
    component: PrefixSuffix,
    componentRaw: PrefixSuffixRaw,
  },
  {
    title: '手动控制',
    component: Manual,
    componentRaw: ManualRaw,
  },
]

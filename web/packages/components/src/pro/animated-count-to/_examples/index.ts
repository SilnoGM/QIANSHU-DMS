import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Format from './_format.vue'
import FormatRaw from './_format.vue?raw'
import GroupBasic from './_group-basic.vue'
import GroupBasicRaw from './_group-basic.vue?raw'
import PrefixSuffix from './_prefix-suffix.vue'
import PrefixSuffixRaw from './_prefix-suffix.vue?raw'
import Timing from './_timing.vue'
import TimingRaw from './_timing.vue?raw'
import Trend from './_trend.vue'
import TrendRaw from './_trend.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '前缀/后缀',
    component: PrefixSuffix,
    componentRaw: PrefixSuffixRaw,
  },
  {
    title: '方向',
    component: Trend,
    componentRaw: TrendRaw,
  },
  {
    title: '格式化',
    component: Format,
    componentRaw: FormatRaw,
  },
  {
    title: '时机',
    component: Timing,
    componentRaw: TimingRaw,
  },
  {
    title: '组',
    component: GroupBasic,
    componentRaw: GroupBasicRaw,
  },
]

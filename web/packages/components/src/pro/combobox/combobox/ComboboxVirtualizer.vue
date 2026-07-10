<script lang="ts">
import type { AcceptableValue, ComboboxVirtualizerProps } from 'reka-ui'
import type { PropType } from 'vue'
import { ComboboxVirtualizer as RekaComboboxVirtualizer } from 'reka-ui'
import { defineComponent, h } from 'vue'

export default defineComponent({
  name: 'ComboboxVirtualizer',
  props: {
    options: {
      type: Array as PropType<ComboboxVirtualizerProps<AcceptableValue>['options']>,
      required: true,
    },
    overscan: Number,
    estimateSize: [Number, Function] as PropType<ComboboxVirtualizerProps<AcceptableValue>['estimateSize']>,
    textContent: Function as PropType<ComboboxVirtualizerProps<AcceptableValue>['textContent']>,
  },
  setup(props, { attrs, slots }) {
    return () => h(RekaComboboxVirtualizer, {
      ...attrs,
      ...props,
      'data-slot': 'combobox-virtualizer',
    }, slots)
  },
})
</script>

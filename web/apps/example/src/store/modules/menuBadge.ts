export const useMenuBadgeStore = defineStore(
  'menuBadge',
  () => {
    const dot = ref(true)
    const number = ref(5)
    const text = ref('HOT')
    const variant = ref<'default' | 'secondary' | 'destructive'>('destructive')

    function switchDot() {
      dot.value = !dot.value
    }
    function setNumber(val: number) {
      number.value = val
    }
    function setText(val: string) {
      text.value = val
    }
    function setVariant(val: 'default' | 'secondary' | 'destructive') {
      variant.value = val
    }

    return {
      dot,
      number,
      text,
      variant,
      switchDot,
      setNumber,
      setText,
      setVariant,
    }
  },
)

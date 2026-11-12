/**
 * 自定义指令：v-click-outside —— 在元素外部按下指针时回调。
 * 用于下拉菜单、划词小卡等浮层。
 */
export const clickOutside = {
  mounted(el, binding) {
    el.__rlOutsideHandler = (event) => {
      if (el === event.target || el.contains(event.target)) return
      const handler = binding.value
      if (typeof handler === 'function') handler(event)
    }
    document.addEventListener('pointerdown', el.__rlOutsideHandler, true)
  },
  unmounted(el) {
    if (el.__rlOutsideHandler) {
      document.removeEventListener('pointerdown', el.__rlOutsideHandler, true)
      delete el.__rlOutsideHandler
    }
  }
}

/**
 * 检查事件是否由表单元素触发
 */
export const isFormEvent = (e: KeyboardEvent | MouseEvent) => {
  const t = e.target as HTMLFormElement
  if (!t) {
    return false
  }

  if (t.form || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) {
    return true
  }
  if (t instanceof HTMLElement && /write/.test(window.getComputedStyle(t).getPropertyValue('-webkit-user-modify'))) {
    return true
  }
  return false
}

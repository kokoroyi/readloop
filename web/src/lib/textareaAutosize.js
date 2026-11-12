/**
 * textarea 自适应高度：1–6 行，超过 maxRows 后内部滚动。
 * @param {HTMLTextAreaElement | null} el
 * @param {{ minRows?: number, maxRows?: number }} [options]
 */
export function autoGrowTextarea(el, options = {}) {
  if (!el) return
  const minRows = options.minRows || 1
  const maxRows = options.maxRows || 6
  const computed = window.getComputedStyle(el)
  const lineHeight = Number.parseFloat(computed.lineHeight) || 20
  const padding =
    (Number.parseFloat(computed.paddingTop) || 0) + (Number.parseFloat(computed.paddingBottom) || 0)
  const border =
    (Number.parseFloat(computed.borderTopWidth) || 0) + (Number.parseFloat(computed.borderBottomWidth) || 0)
  const minHeight = lineHeight * minRows + padding + border
  const maxHeight = lineHeight * maxRows + padding + border
  el.style.height = 'auto'
  const next = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight))
  el.style.height = `${next}px`
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

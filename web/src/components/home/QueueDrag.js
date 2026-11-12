/**
 * 阅读台待读队列排序的纯逻辑：
 * 可见前 5 条重排后，与第 5 条之后的原顺序拼接成完整队列 id 顺序；
 * 以及乐观更新时只重排 queue 条目、保持 articles 数组中其他状态条目的位置。
 */

/** 把数组中的 from 项移动到 to 位置（返回新数组）。 */
export function moveWithin(items, fromIndex, toIndex) {
  const list = Array.isArray(items) ? items.slice() : []
  if (fromIndex < 0 || fromIndex >= list.length) return list
  const target = Math.max(0, Math.min(list.length - 1, toIndex))
  if (target === fromIndex) return list
  const [item] = list.splice(fromIndex, 1)
  list.splice(target, 0, item)
  return list
}

/**
 * 可见 5 条拖拽后的完整队列 id 顺序：
 * newVisibleOrders 为新顺序的 id 数组；allQueueItems 为原始全量待读队列（含第 5 条之后）。
 */
export function buildFullQueueIds(newVisibleIds, allQueueItems) {
  const visibleSet = new Set(newVisibleIds)
  const rest = (allQueueItems || []).map((item) => item.id).filter((id) => !visibleSet.has(id))
  return [...newVisibleIds, ...rest]
}

/**
 * 按给定队列 id 顺序重排 articles 数组中的 queued 项，其他状态条目位置不变。
 */
export function applyQueueOrder(articles, orderedQueueIds) {
  const list = (articles || []).slice()
  const queued = list.filter((item) => item.status === 'queued')
  const byId = new Map(queued.map((item) => [item.id, item]))
  const ordered = orderedQueueIds.map((id) => byId.get(id)).filter(Boolean)
  if (!ordered.length) return list
  let cursor = 0
  return list.map((item) => {
    if (item.status !== 'queued') return item
    const next = ordered[cursor]
    cursor += 1
    return next || item
  })
}

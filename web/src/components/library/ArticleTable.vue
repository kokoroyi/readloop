<script setup>
/**
 * 文章库表格：状态、进度、句数、跳过、更新时间、行内操作菜单；
 * 支持批量勾选与待读队列排序（置顶/上移/下移）。
 */
import { computed } from 'vue'
import Icon from '../ui/Icon.vue'
import MenuPopover from '../ui/MenuPopover.vue'
import { formatRelative } from '../../lib/time.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  selected: { type: Array, default: () => [] },
  reorderMode: { type: Boolean, default: false },
  busyId: { type: [Number, String], default: null }
})

const emit = defineEmits(['open', 'menu-action', 'move', 'toggle-select', 'toggle-page'])

const SOURCE_LABEL = { paste: '粘贴文本', txt: 'TXT 文件', md: 'Markdown' }

const STATUS_META = {
  queued: { label: '待读', className: 'chip-queued', dot: false },
  reading: { label: '精读中', className: 'chip-read', dot: true },
  recap: { label: '复盘中', className: 'chip-accent', dot: true },
  done: { label: '已复盘', className: 'chip-done', dot: false }
}

const selectedOnPage = computed(() => props.items.filter((item) => props.selected.includes(item.id)))
const allOnPageSelected = computed(
  () => props.items.length > 0 && selectedOnPage.value.length === props.items.length
)
const someOnPageSelected = computed(
  () => selectedOnPage.value.length > 0 && selectedOnPage.value.length < props.items.length
)

function statusMeta(status) {
  return STATUS_META[status] || { label: status || '未知', className: 'chip-queued', dot: false }
}

function sourceText(item) {
  if (item.sourceName) return item.sourceName
  return SOURCE_LABEL[item.sourceFormat] || '文章'
}

function progressPercent(item) {
  const raw = Number(item.progress)
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw))
  }
  if (raw === 0) return 0
  const total = Number(item.sentenceCount) || 0
  const processed = Number(item.processedCount) || 0
  return total ? Math.min(100, Math.round((processed / total) * 100)) : 0
}

function rowMenuItems(item) {
  if (item.status === 'done') {
    return [
      { id: 'review', label: '回顾', icon: 'book-open' },
      { id: 'record', label: '查看记录', icon: 'file-text' },
      { id: 'reread', label: '重新精读', icon: 'refresh' },
      { separator: true },
      { id: 'delete', label: '删除文章', icon: 'trash', danger: true }
    ]
  }
  const primary = {
    queued: { id: 'open', label: '开始精读', icon: 'log-in' },
    reading: { id: 'open', label: '继续精读', icon: 'book-open' },
    recap: { id: 'open', label: '进入复盘', icon: 'refresh' }
  }[item.status]
  return [
    primary || { id: 'open', label: '打开', icon: 'book-open' },
    { separator: true },
    { id: 'delete', label: '删除文章', icon: 'trash', danger: true }
  ]
}

function onTogglePage() {
  if (props.reorderMode) return
  emit('toggle-page')
}

function onToggleRow(id) {
  if (props.reorderMode) return
  emit('toggle-select', id)
}
</script>

<template>
  <div class="table-scroll">
    <table class="table table-fixed lib-table">
      <colgroup>
        <col :style="{ width: props.reorderMode ? '96px' : '42px' }" />
        <col />
        <col style="width: 108px" />
        <col style="width: 164px" />
        <col style="width: 68px" />
        <col style="width: 68px" />
        <col style="width: 132px" />
        <col style="width: 58px" />
      </colgroup>
      <thead>
        <tr>
          <th>
            <input
              v-if="!props.reorderMode"
              class="checkbox"
              type="checkbox"
              aria-label="全选本页文章"
              :checked="allOnPageSelected"
              :indeterminate.prop="someOnPageSelected"
              @change="onTogglePage"
            />
            <span v-else class="th-hint">顺序</span>
          </th>
          <th>文章</th>
          <th>状态</th>
          <th>进度</th>
          <th>句数</th>
          <th>跳过</th>
          <th>更新时间</th>
          <th class="tbl-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in props.items"
          :key="item.id"
          :class="{ 'is-done': item.status === 'done', 'is-busy': String(props.busyId) === String(item.id) }"
        >
          <td>
            <div v-if="props.reorderMode" class="reorder-group">
              <template v-if="item.status === 'queued'">
                <button type="button" class="reorder-btn" aria-label="置顶" title="置顶" @click="emit('move', { id: item.id, direction: 'top' })">
                  <Icon name="pin" :size="13" />
                </button>
                <button type="button" class="reorder-btn" aria-label="上移" title="上移" @click="emit('move', { id: item.id, direction: 'up' })">
                  <Icon name="arrow-up" :size="13" />
                </button>
                <button type="button" class="reorder-btn" aria-label="下移" title="下移" @click="emit('move', { id: item.id, direction: 'down' })">
                  <Icon name="arrow-down" :size="13" />
                </button>
              </template>
            </div>
            <input
              v-else
              class="checkbox"
              type="checkbox"
              :checked="props.selected.includes(item.id)"
              :aria-label="`选择 ${item.title}`"
              @change="onToggleRow(item.id)"
            />
          </td>
          <td>
            <button type="button" class="title-btn" :title="item.title" @click="emit('open', item)">
              <span class="tbl-title">{{ item.title }}</span>
              <span class="tbl-sub">{{ sourceText(item) }} · {{ item.sentenceCount }} 句</span>
            </button>
          </td>
          <td>
            <span class="chip" :class="statusMeta(item.status).className">
              <span v-if="statusMeta(item.status).dot" class="chip-dot" />
              {{ statusMeta(item.status).label }}
            </span>
          </td>
          <td>
            <div v-if="item.status !== 'queued'" class="lib-progress">
              <div class="progress thin"><i :style="{ width: `${progressPercent(item)}%` }" /></div>
              <span class="lib-pct">{{ progressPercent(item) }}%</span>
            </div>
            <span v-else class="lib-dash">—</span>
          </td>
          <td class="tbl-num">{{ item.sentenceCount }}</td>
          <td class="tbl-num">{{ item.status === 'queued' ? '—' : item.skippedCount || 0 }}</td>
          <td><span class="tbl-time">{{ formatRelative(item.updatedAt) }}</span></td>
          <td class="tbl-actions">
            <MenuPopover
              :items="rowMenuItems(item)"
              :aria-label="`${item.title} 的更多操作`"
              @select="(action) => emit('menu-action', { action, item })"
            >
              <template #default="{ toggle }">
                <button
                  type="button"
                  class="icon-btn row-more"
                  :aria-label="`${item.title} 的更多操作`"
                  @click.stop="toggle"
                >
                  <Icon name="more" :size="16" />
                </button>
              </template>
            </MenuPopover>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.lib-table {
  min-width: 900px;
}

.th-hint {
  font-size: var(--text-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--paper-ink-3);
}

.title-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
}

.title-btn:hover .tbl-title {
  color: var(--paper-accent);
}

.lib-progress {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.lib-progress .progress {
  flex: 1 1 auto;
}

.lib-pct {
  flex: 0 0 36px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--paper-ink-2);
}

.is-done .progress > i {
  background: var(--paper-green);
}

.is-busy {
  opacity: 0.55;
}

.lib-dash {
  color: var(--paper-ink-3);
  font-family: var(--font-mono);
}

.tbl-time {
  font-size: var(--text-base);
  color: var(--paper-ink-2);
  white-space: nowrap;
}

.row-more {
  width: 28px;
  height: 28px;
  border-color: transparent;
  background: transparent;
  color: var(--paper-ink-3);
}

.row-more:hover {
  border-color: var(--paper-line);
  background: var(--paper-surface-2);
}

.reorder-group {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.reorder-btn {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-sm);
  background: var(--paper-surface);
  color: var(--paper-ink-2);
}

.reorder-btn:hover {
  background: var(--paper-accent-soft);
  color: var(--paper-accent);
}
</style>

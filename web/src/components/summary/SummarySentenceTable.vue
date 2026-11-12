<script setup>
/**
 * 学习小结·逐句对照表：序号 / 原句 / 我的译文 / 参考译文 / 问题标签；
 * 默认展开，可折叠。
 */
import { computed, ref } from 'vue'
import Button from '../ui/Button.vue'

const props = defineProps({
  rows: { type: Array, default: () => [] }
})

const expanded = ref(true)

const visibleRows = computed(() => (expanded.value ? props.rows : props.rows.slice(0, 3)))

function tagTone(type) {
  if (type === '漏译') return 'tag-amber'
  if (type === '误译') return 'tag-rust'
  return 'tag-blue'
}
</script>

<template>
  <section class="card summary-card">
    <div class="summary-card-head">
      <h2 class="card-title">逐句对照</h2>
      <span class="summary-count">{{ props.rows.length }} 句</span>
      <Button
        v-if="props.rows.length > 3"
        size="sm"
        variant="ghost"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : `展开全部 ${props.rows.length} 句` }}
      </Button>
    </div>

    <div v-if="visibleRows.length" class="cmp-list">
      <div v-for="row in visibleRows" :key="row.idx" class="cmp-row">
        <span class="cmp-idx">{{ String(row.idx + 1).padStart(2, '0') }}</span>
        <div class="cmp-src">{{ row.text }}</div>
        <div class="cmp-pair">
          <span class="cmp-k">我的译文</span>
          <span class="cmp-mine">{{ row.myTranslation || '—' }}</span>
          <span class="cmp-k">参考译文</span>
          <span class="cmp-ref">{{ row.referenceTranslation || '—' }}</span>
        </div>
        <div class="cmp-tags">
          <span v-if="row.status === 'skipped'" class="tag tag-amber">已跳过</span>
          <template v-else-if="row.issues.length">
            <span v-for="(issue, index) in row.issues" :key="index" class="tag" :class="tagTone(issue.type)">
              {{ issue.type }}
            </span>
          </template>
          <span v-else-if="row.status === 'corrected'" class="tag tag-green">通过</span>
          <span v-else class="tag">未批改</span>
        </div>
      </div>
    </div>
    <p v-else class="summary-empty">这篇文章没有逐句记录。</p>

    <button
      v-if="props.rows.length > 3 && !expanded"
      type="button"
      class="cmp-more"
      @click="expanded = true"
    >
      展开全部 {{ props.rows.length }} 句
    </button>
  </section>
</template>


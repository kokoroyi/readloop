<script setup>
/**
 * 阅读台·阅读统计：已复盘篇数 / 累计阅读时长 / 累计翻译句数 / 连续阅读天数。
 */
import { computed } from 'vue'
import { formatStudyDuration } from '../../lib/calendar.js'

const props = defineProps({
  overview: { type: Object, default: null },
  loading: { type: Boolean, default: false }
})

const stats = computed(() => {
  const overview = props.overview || {}
  return [
    { key: 'reviewed', value: String(overview.reviewedArticles ?? 0), unit: '篇', label: '已复盘' },
    { key: 'seconds', value: formatStudyDuration(overview.totalSeconds), unit: '', label: '累计阅读' },
    { key: 'sentences', value: String(overview.totalSentences ?? 0), unit: '句', label: '翻译句数' },
    { key: 'streak', value: String(overview.streakDays ?? 0), unit: '天', label: '连续阅读' }
  ]
})
</script>

<template>
  <section class="card home-card home-stats-card" aria-label="阅读统计">
    <header class="home-card-head">
      <h2 class="home-card-title">阅读统计</h2>
    </header>
    <div class="home-stats">
      <div v-for="item in stats" :key="item.key" class="stat-cell">
        <div class="stat-value">
          {{ props.loading ? '—' : item.value }}<small v-if="item.unit && !props.loading">{{ item.unit }}</small>
        </div>
        <div class="stat-label">{{ item.label }}</div>
      </div>
    </div>
  </section>
</template>

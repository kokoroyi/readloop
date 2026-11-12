<script setup>
/**
 * 阅读台·活跃日历：月视图色阶、上下月切换（未来月禁用）、今天描边、
 * 点击日期显示当日阅读分钟/处理句数。
 */
import { computed, ref, watch } from 'vue'
import { buildMonthGrid, dayDetail, levelClass, WEEKDAY_LABELS } from '../../lib/calendar.js'

const props = defineProps({
  year: { type: Number, required: true },
  month: { type: Number, required: true },
  days: { type: Array, default: () => [] },
  canNext: { type: Boolean, default: true },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['change-month'])

const selectedDate = ref('')

const dayMap = computed(() => {
  const map = {}
  for (const day of props.days || []) map[day.date] = day
  return map
})

const cells = computed(() => buildMonthGrid(props.year, props.month))

const selectedDay = computed(() => (selectedDate.value ? dayMap.value[selectedDate.value] : null))

watch(
  () => [props.year, props.month],
  () => {
    selectedDate.value = ''
  }
)

function selectCell(cell) {
  if (!cell.inMonth) return
  selectedDate.value = selectedDate.value === cell.date ? '' : cell.date
}

function cellLabel(cell) {
  const day = dayMap.value[cell.date]
  return `${cell.date}${cell.isToday ? '，今天' : ''}${day ? `，阅读 ${day.minutes} 分钟，处理 ${day.sentences} 句` : ''}`
}
</script>

<template>
  <section class="card home-card home-calendar" aria-label="阅读活跃日历">
    <header class="home-card-head">
      <h2 class="home-card-title">阅读活跃</h2>
      <span class="home-card-hint">按月查看</span>
    </header>

    <div class="cal-head">
      <p class="cal-title">{{ props.year }} 年 {{ props.month + 1 }} 月</p>
      <div class="cal-nav">
        <button type="button" class="icon-btn" aria-label="上个月" @click="emit('change-month', -1)">
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="下个月"
          :disabled="!props.canNext"
          @click="emit('change-month', 1)"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>

    <div class="cal-weekdays" aria-hidden="true">
      <span v-for="label in WEEKDAY_LABELS" :key="label">{{ label }}</span>
    </div>

    <div class="cal-grid" role="group" aria-label="活跃日历">
      <button
        v-for="cell in cells"
        :key="cell.date"
        type="button"
        class="cal-day"
        :class="[
          levelClass(dayMap[cell.date] ? dayMap[cell.date].level : 0),
          {
            'is-outside': !cell.inMonth,
            'is-today': cell.isToday,
            'is-selected': selectedDate === cell.date
          }
        ]"
        :aria-label="cellLabel(cell)"
        :aria-pressed="selectedDate === cell.date"
        :disabled="!cell.inMonth"
        @click="selectCell(cell)"
      >
        <span>{{ cell.day }}</span>
      </button>
    </div>

    <div class="cal-foot">
      <div class="cal-legend">
        <span>少</span>
        <i class="cal-legend-cell cal-level-0" />
        <i class="cal-legend-cell cal-level-1" />
        <i class="cal-legend-cell cal-level-2" />
        <i class="cal-legend-cell cal-level-3" />
        <i class="cal-legend-cell cal-level-4" />
        <span>多</span>
      </div>
      <p class="cal-detail" :class="{ 'cal-detail-hint': !selectedDay }">
        {{ selectedDay ? dayDetail(selectedDay) : '点击日期查看当天明细' }}
      </p>
    </div>
  </section>
</template>

<script setup>
/**
 * 设置·关于与日志：版本 / 端口 / 数据库 / 词典 / 路径 + 最近日志（刷新、级别色点）。
 */
import { computed, onMounted } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import { formatBytes, loadLogs, loadSystemInfo, systemStore } from '../../stores/system.js'
import { settingsStore } from '../../stores/settings.js'
import { formatDateTime } from '../../lib/time.js'

const health = computed(() => settingsStore.health || {})
const info = computed(() => systemStore.info)

const rows = computed(() => [
  {
    label: '应用版本',
    value: info.value && info.value.version ? `v${info.value.version}` : health.value.version ? `v${health.value.version}` : '—'
  },
  { label: '构建时间', value: '—（接口暂未提供）' },
  {
    label: '服务端口',
    value: info.value && info.value.port ? `127.0.0.1:${info.value.port}` : health.value.port ? `127.0.0.1:${health.value.port}` : '—'
  },
  {
    label: '数据库',
    value: info.value
      ? `${info.value.dbPath || '—'}（${formatBytes(info.value.dbSizeBytes)}）`
      : health.value.db
        ? '已连接'
        : '未就绪'
  },
  {
    label: '词典',
    value: info.value
      ? `${info.value.dictOk ? '已就位' : '不可用'} · ${info.value.dictPath || '—'}`
      : health.value.dict
        ? '已就位'
        : '未找到'
  },
  { label: '数据目录', value: info.value ? info.value.dataDir || '—' : '—' },
  { label: '前端', value: 'Vue 3.5 + Vite 7 · 本地部署，无 CDN' }
])

function levelLabel(level) {
  return { info: '信息', warn: '警告', error: '错误', debug: '调试' }[level] || level
}

onMounted(() => {
  if (!systemStore.info) loadSystemInfo()
  loadLogs(200)
})
</script>

<template>
  <section>
    <header class="settings-section-head">
      <h2 class="settings-section-title">关于与日志</h2>
      <span class="settings-section-desc">本机服务信息与最近 200 条日志</span>
    </header>

    <dl class="about-list">
      <div v-for="row in rows" :key="row.label" class="about-row">
        <dt class="about-label">{{ row.label }}</dt>
        <dd class="about-value mono">{{ row.value }}</dd>
      </div>
    </dl>

    <section class="logs-panel">
      <header class="logs-head">
        <h3 class="logs-title">日志</h3>
        <span class="logs-hint">新 → 旧 · 最近 200 条</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="刷新日志"
          :loading="systemStore.logsLoading"
          @click="loadLogs(200)"
        >
          <Icon name="refresh" :size="13" />
          刷新
        </Button>
      </header>

      <div v-if="systemStore.logsError" class="note note-error" role="alert">
        <Icon name="alert" :size="14" />
        <span>读取日志失败，可以确认本地服务是否在运行。</span>
        <Button size="sm" variant="secondary" @click="loadLogs(200)">重试</Button>
      </div>
      <p v-else-if="systemStore.logsLoading && !systemStore.logs.length" class="logs-empty">正在读取日志…</p>
      <div v-else-if="systemStore.logs.length" class="logs-list">
        <div v-for="log in systemStore.logs" :key="log.id ?? log.createdAt + log.message" class="log-row">
          <span class="log-dot" :class="`is-${log.level}`" :title="levelLabel(log.level)" />
          <span class="log-time mono">{{ formatDateTime(log.createdAt) }}</span>
          <span v-if="log.module" class="log-module">{{ log.module }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
      </div>
      <p v-else class="logs-empty">还没有日志记录。</p>
    </section>

    <section class="license-block">
      <h3 class="logs-title">第三方许可</h3>
      <p class="settings-section-desc">
        ReadLoop 使用 Vue、vue-router、Vite、Express、better-sqlite3（均为 MIT 许可）。前端不引用任何
        CDN、字体或统计脚本。
      </p>
    </section>
  </section>
</template>

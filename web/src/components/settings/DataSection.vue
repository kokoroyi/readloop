<script setup>
/**
 * 设置·数据管理：数据目录 / 数据库 / 词典状态 / 本月 AI 用量 / 导出备份 / 清空学习数据。
 * 词典 v1 只展示、校验与提示（更换请改设置）；备份只导出不提供恢复按钮。
 */
import { computed, onMounted, ref } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import Modal from '../ui/Modal.vue'
import Skeleton from '../ui/Skeleton.vue'
import { copyText } from '../../lib/clipboard.js'
import {
  clearLearningData,
  formatBytes,
  loadSystemInfo,
  runBackup,
  systemStore
} from '../../stores/system.js'
import { toast } from '../../stores/toast.js'

const info = computed(() => systemStore.info)
const clearOpen = ref(false)
const keepWords = ref(true)

onMounted(() => {
  if (!systemStore.info) loadSystemInfo()
})

async function onValidateDict() {
  await loadSystemInfo({ silent: true })
  if (info.value && info.value.dictOk) toast.success('词典可用（路径与表结构正常）')
  else toast.error('词典不可用：请检查词典文件是否存在、表结构是否正确')
}

async function onBackup() {
  const result = await runBackup()
  if (result.ok) toast.success(`备份已导出：${result.result.path}`)
  else toast.error(`导出备份失败：${result.error}`)
}

async function onCopyBackupPath() {
  if (!systemStore.backupResult) return
  const ok = await copyText(systemStore.backupResult.path)
  if (ok) toast.success('备份路径已复制')
  else toast.error('复制失败，请手动选择路径')
}

async function onCopyDataDir() {
  if (!info.value || !info.value.dataDir) return
  const ok = await copyText(info.value.dataDir)
  if (ok) toast.success('数据目录已复制')
  else toast.error('复制失败，请手动选择路径')
}

function openClear() {
  keepWords.value = true
  clearOpen.value = true
}

async function confirmClear() {
  const result = await clearLearningData({ keepWords: keepWords.value })
  if (result.ok) {
    clearOpen.value = false
    toast.success('学习数据已清空')
    await loadSystemInfo({ silent: true })
  } else {
    toast.error(`清空失败：${result.error}`)
  }
}

const removedSummary = computed(() => {
  if (!systemStore.clearResult) return ''
  return systemStore.clearResult.removed
    .filter((item) => item.count > 0)
    .map((item) => `${item.label} ${item.count}`)
    .join(' · ')
})
</script>

<template>
  <section class="data-section">
    <header class="settings-section-head">
      <h2 class="settings-section-title">数据管理</h2>
      <span class="settings-section-desc">所有数据保存在本机数据目录；这里可以查看路径、导出备份与清空学习数据</span>
    </header>

    <div v-if="systemStore.infoLoading && !info" class="data-loading" aria-busy="true">
      <div v-for="index in 4" :key="index" class="data-loading-row">
        <Skeleton width="100px" height="12px" />
        <Skeleton width="62%" height="14px" />
      </div>
    </div>

    <div v-else-if="systemStore.infoError" class="note note-error" role="alert">
      <Icon name="alert" :size="14" />
      <span>读取系统信息失败，可以确认本地服务是否在运行。</span>
      <Button size="sm" variant="secondary" @click="loadSystemInfo">重试</Button>
    </div>

    <template v-else-if="info">
      <div class="data-grid">
        <div class="data-row">
          <span class="data-label">数据目录</span>
          <span class="data-value path-value">{{ info.dataDir || '—' }}</span>
          <Button size="sm" variant="ghost" aria-label="复制数据目录" @click="onCopyDataDir">复制</Button>
        </div>
        <div class="data-row">
          <span class="data-label">数据库</span>
          <span class="data-value path-value">{{ info.dbPath || '—' }}</span>
          <span class="data-tail mono">{{ formatBytes(info.dbSizeBytes) }}</span>
        </div>
        <div class="data-row">
          <span class="data-label">词典</span>
          <span class="data-value path-value">
            {{ info.dictPath || '未找到词典' }}
            <span class="tag" :class="info.dictOk ? 'tag-green' : 'tag-rust'">
              {{ info.dictOk ? '可用' : '不可用' }}
            </span>
          </span>
          <Button size="sm" variant="secondary" aria-label="校验词典" @click="onValidateDict">校验词典</Button>
        </div>
        <div class="data-row data-row-hint">
          <span class="data-label" />
          <span class="data-value data-hint">
            词典路径在 v1 由设置决定，更换词典请修改配置文件后重启；这里只做展示与校验。
          </span>
        </div>
      </div>

      <section class="data-block">
        <header class="data-block-head">
          <h3 class="data-block-title">本月 AI 用量</h3>
          <span class="data-block-desc">按本地月份统计 ai_calls</span>
        </header>
        <div class="usage-cards">
          <div class="usage-card">
            <b>{{ info.aiUsageThisMonth.calls }}</b>
            <span>调用次数</span>
          </div>
          <div class="usage-card">
            <b>{{ info.aiUsageThisMonth.inputTokens }}</b>
            <span>输入 tokens</span>
          </div>
          <div class="usage-card">
            <b>{{ info.aiUsageThisMonth.outputTokens }}</b>
            <span>输出 tokens</span>
          </div>
        </div>
      </section>

      <section class="data-block">
        <header class="data-block-head">
          <h3 class="data-block-title">导出备份</h3>
          <span class="data-block-desc">导出 SQLite 数据库副本（先 checkpoint，保留最近 5 份）</span>
        </header>
        <div class="data-actions">
          <Button variant="secondary" aria-label="导出备份" :loading="systemStore.backupLoading" @click="onBackup">
            <Icon name="download" :size="14" />
            导出备份
          </Button>
          <span class="data-block-desc">v1 不提供「恢复备份」按钮，需要恢复时请手动替换数据目录中的数据库文件。</span>
        </div>
        <div v-if="systemStore.backupError" class="note note-error" role="alert">
          <Icon name="alert" :size="14" />
          <span>导出备份失败：{{ systemStore.backupError }}</span>
        </div>
        <div v-if="systemStore.backupResult" class="backup-result">
          <div class="backup-path">
            <span class="data-label">备份文件</span>
            <span class="mono path-value">{{ systemStore.backupResult.path }}</span>
            <span class="data-tail">{{ formatBytes(systemStore.backupResult.sizeBytes) }}</span>
            <Button size="sm" variant="ghost" aria-label="复制备份路径" @click="onCopyBackupPath">复制路径</Button>
          </div>
        </div>
      </section>

      <section class="data-block danger-zone">
        <header class="data-block-head">
          <h3 class="data-block-title">清空学习数据</h3>
          <span class="data-block-desc">删除全部文章、逐句记录、复盘、小结、计时与日志；设置保留</span>
        </header>
        <div class="data-actions">
          <Button variant="danger" aria-label="清空学习数据" @click="openClear">清空学习数据</Button>
          <span class="data-block-desc">操作不可撤销，建议先导出备份。</span>
        </div>
        <div v-if="removedSummary" class="clear-result">
          上次清空：{{ removedSummary }}
        </div>
      </section>
    </template>

    <Modal v-model="clearOpen" title="清空学习数据？" subtitle="此操作不可撤销，设置会保留">
      <div class="clear-modal">
        <p class="clear-warning">
          将删除全部文章、句子、逐句批改、句内追问、阅读计时、复盘记录、学习小结、AI 调用记录与日志。
        </p>
        <label class="clear-check">
          <input v-model="keepWords" type="checkbox" class="checkbox" />
          <span>保留收藏词（推荐）</span>
        </label>
        <p class="clear-hint">
          取消勾选会同时删除词库中的收藏词；设置、外观与 AI 配置不受影响。
        </p>
        <div v-if="systemStore.clearError" class="note note-error" role="alert">
          <Icon name="alert" :size="14" />
          <span>清空失败：{{ systemStore.clearError }}</span>
        </div>
      </div>
      <template #foot>
        <Button variant="ghost" @click="clearOpen = false">取消</Button>
        <Button variant="danger" aria-label="确认清空学习数据" :loading="systemStore.clearing" @click="confirmClear">
          确认清空
        </Button>
      </template>
    </Modal>
  </section>
</template>

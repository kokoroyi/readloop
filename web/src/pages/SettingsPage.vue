<script setup>
/**
 * 设置页：左侧分区导航（AI 配置 / 阅读外观 / 复盘 / 数据管理 / 关于与日志）。
 * M1–M5 分区全部接线：AI、外观、复盘、数据管理、关于与日志。
 */
import { computed, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AboutSection from '../components/settings/AboutSection.vue'
import AiConfigSection from '../components/settings/AiConfigSection.vue'
import AppearanceSection from '../components/settings/AppearanceSection.vue'
import DataSection from '../components/settings/DataSection.vue'
import RecapSection from '../components/settings/RecapSection.vue'
import SettingsNav from '../components/settings/SettingsNav.vue'
import Button from '../components/ui/Button.vue'
import Icon from '../components/ui/Icon.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import { describeError } from '../lib/api.js'
import { applyAppearance, loadSettings, settingsStore } from '../stores/settings.js'

const SECTIONS = [
  { id: 'ai', label: 'AI 配置', icon: 'sparkles' },
  { id: 'appearance', label: '阅读外观', icon: 'book-open' },
  { id: 'recap', label: '复盘', icon: 'refresh' },
  { id: 'data', label: '数据管理', icon: 'database' },
  { id: 'about', label: '关于与日志', icon: 'info' }
]

const SECTION_IDS = SECTIONS.map((section) => section.id)

const route = useRoute()
const router = useRouter()

const activeSection = computed(() => {
  const section = typeof route.query.section === 'string' ? route.query.section : ''
  return SECTION_IDS.includes(section) ? section : 'ai'
})

const loading = computed(() => settingsStore.loading && !settingsStore.ready)
const loadError = computed(() => settingsStore.loadError)

function selectSection(id) {
  if (id === activeSection.value) return
  router.replace({ path: '/settings', query: { section: id } }).catch(() => {})
}

function retryLoad() {
  loadSettings()
}

// 离开设置页时把未保存的主题预览回退到已保存外观。
onBeforeUnmount(() => {
  applyAppearance()
})
</script>

<template>
  <div class="container settings-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">全部配置保存在本机，修改后即时生效</p>
      </div>
    </header>

    <div class="settings-layout">
      <SettingsNav :sections="SECTIONS" :active="activeSection" @select="selectSection" />

      <section class="card settings-main">
        <div v-if="loading" class="loading" aria-busy="true">
          <Skeleton width="180px" height="20px" />
          <div v-for="index in 4" :key="index" class="loading-field">
            <Skeleton width="88px" height="12px" />
            <Skeleton height="38px" radius="9px" />
          </div>
        </div>

        <div v-else-if="loadError" class="load-error">
          <div class="note note-error" role="alert">
            <Icon name="alert" :size="14" />
            <span>
              读取设置失败：{{ describeError(loadError) }}。可以确认本地服务是否在运行，然后重试。
            </span>
          </div>
          <Button variant="primary" class="retry-btn" @click="retryLoad">重试读取</Button>
        </div>

        <template v-else>
          <AiConfigSection v-if="activeSection === 'ai'" />
          <AppearanceSection v-else-if="activeSection === 'appearance'" />
          <RecapSection v-else-if="activeSection === 'recap'" />
          <DataSection v-else-if="activeSection === 'data'" />
          <AboutSection v-else-if="activeSection === 'about'" />
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  padding-bottom: var(--space-16);
}

.settings-layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: var(--space-9);
  align-items: stretch;
}

.settings-main {
  padding: var(--space-8) var(--space-11) var(--space-10);
  min-width: 0;
}

.loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.loading-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.load-error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-6);
}

.retry-btn {
  align-self: flex-start;
}

@media (max-width: 1100px) {
  .settings-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

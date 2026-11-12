<script setup>
/**
 * 应用壳：顶栏 + 内容区；负责首屏加载、服务不可达整页提示、全局错误边界与 Toast 宿主。
 */
import { computed, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppTopBar from './components/AppTopBar.vue'
import AppErrorScreen from './components/AppErrorScreen.vue'
import ServiceUnavailable from './components/ServiceUnavailable.vue'
import ToastHost from './components/ui/ToastHost.vue'
import { describeError } from './lib/api.js'
import {
  initSettings,
  loadHealth,
  loadSettings,
  retryBoot,
  serviceDown,
  settingsStore
} from './stores/settings.js'
import { toast } from './stores/toast.js'

const route = useRoute()
const router = useRouter()
const mainEl = ref(null)
const fatal = ref(null)
const retrying = ref(false)
const narrowDismissed = ref(false)

let retryTimer = null

const immersive = computed(() => Boolean(route.meta && route.meta.immersive))

function newErrorCode() {
  return `E-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

function captureFatal(err, source) {
  if (fatal.value) return
  const code = newErrorCode()
  fatal.value = { code, message: describeError(err) }
  console.error(`[ReadLoop] 页面级错误 ${code}（${source}）`, err)
}

// 页面级错误边界：任何子树渲染/生命周期异常都落到 AppErrorScreen（带错误编号）。
onErrorCaptured((err, _instance, info) => {
  captureFatal(err, `vue:${info}`)
  return false
})

function onWindowError(event) {
  if (!event || !event.error) return
  captureFatal(event.error, 'window.error')
}

function onUnhandledRejection(event) {
  const reason = event && event.reason
  console.error('[ReadLoop] 未处理的 Promise 拒绝', reason)
  if (fatal.value) return
  toast.error(`操作失败：${describeError(reason)}`)
}

async function onRetry() {
  retrying.value = true
  try {
    await retryBoot()
  } finally {
    retrying.value = false
  }
}

function goHome() {
  fatal.value = null
  router.push('/').catch(() => {})
}

function reloadPage() {
  window.location.reload()
}

watch(
  () => route.fullPath,
  () => {
    if (mainEl.value) mainEl.value.scrollTop = 0
    if (fatal.value) fatal.value = null
  }
)

watch(serviceDown, (down) => {
  if (down) {
    if (!retryTimer) {
      retryTimer = setInterval(() => {
        if (serviceDown.value) loadHealth()
      }, 15000)
    }
    return
  }
  if (retryTimer) {
    clearInterval(retryTimer)
    retryTimer = null
  }
  if (!settingsStore.ready && !settingsStore.loading) loadSettings()
})

onMounted(async () => {
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  await initSettings()
})

onBeforeUnmount(() => {
  window.removeEventListener('error', onWindowError)
  window.removeEventListener('unhandledrejection', onUnhandledRejection)
  if (retryTimer) clearInterval(retryTimer)
})
</script>

<template>
  <div class="app-shell">
    <AppTopBar v-if="!immersive" />
    <main ref="mainEl" class="app-main">
      <ServiceUnavailable v-if="serviceDown && !fatal" :retrying="retrying" @retry="onRetry" />
      <AppErrorScreen
        v-else-if="fatal"
        :code="fatal.code"
        :message="fatal.message"
        @reload="reloadPage"
        @home="goHome"
      />
      <RouterView v-else />
    </main>

    <div class="narrow-layer" :class="{ dismissed: narrowDismissed }" role="note">
      <div class="narrow-card">
        <h2 class="narrow-title">窗口过窄</h2>
        <p class="narrow-text">
          ReadLoop 按桌面宽度设计，建议把窗口放宽到 1024×720 以上；继续缩小可能看不到完整的批注与表格。
        </p>
        <button
          type="button"
          class="btn btn-secondary"
          @click="narrowDismissed = true"
        >
          继续查看
        </button>
      </div>
    </div>

    <ToastHost />
  </div>
</template>

<style scoped>
.narrow-layer {
  display: none;
}

@media (max-width: 1023px) {
  .narrow-layer:not(.dismissed) {
    position: fixed;
    inset: 0;
    z-index: var(--z-tip);
    display: grid;
    place-items: center;
    padding: var(--space-15);
    background: var(--overlay-bg);
    backdrop-filter: blur(2px);
  }
}

.narrow-card {
  width: 440px;
  max-width: 100%;
  padding: var(--space-12) var(--space-12) var(--space-10);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-xl);
  background: var(--paper-surface);
  box-shadow: var(--shadow-pop);
  text-align: center;
}

.narrow-title {
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: 700;
  margin-bottom: var(--space-4);
}

.narrow-text {
  font-size: var(--text-md);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
  margin-bottom: var(--space-8);
}
</style>

<script setup>
/**
 * 复盘加载 / 不存在 / 打开失败 三种页面状态。
 */
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import Skeleton from '../ui/Skeleton.vue'
import { describeError } from '../../lib/api.js'

const props = defineProps({
  loading: { type: Boolean, default: false },
  notFound: { type: Boolean, default: false },
  error: { type: Object, default: null }
})

const emit = defineEmits(['retry', 'back', 'restart'])
</script>

<template>
  <div v-if="props.loading" class="recap-loading" aria-busy="true">
    <Skeleton width="180px" height="12px" />
    <Skeleton width="46%" height="30px" />
    <Skeleton width="260px" height="12px" />
    <div v-for="index in 2" :key="index" class="recap-loading-card">
      <Skeleton width="70%" height="14px" />
      <Skeleton width="92%" height="14px" />
      <Skeleton width="88%" height="14px" />
    </div>
  </div>

  <div v-else-if="props.notFound" class="card recap-state-card">
    <div class="state-icon"><Icon name="refresh" :size="22" /></div>
    <h2 class="state-title">复盘记录不存在</h2>
    <p class="state-text">这篇文章的复盘会话尚未创建，可以重新出题，或回到文章库。</p>
    <div class="state-actions">
      <Button variant="primary" @click="emit('restart')">重新出题</Button>
      <Button @click="emit('back')">回文章库</Button>
    </div>
  </div>

  <div v-else-if="props.error" class="card recap-state-card">
    <div class="state-icon"><Icon name="alert" :size="22" /></div>
    <h2 class="state-title">打开复盘失败</h2>
    <p class="state-text">{{ describeError(props.error) }}</p>
    <div class="state-actions">
      <Button variant="primary" @click="emit('retry')">重试</Button>
      <Button @click="emit('back')">回文章库</Button>
    </div>
  </div>
</template>

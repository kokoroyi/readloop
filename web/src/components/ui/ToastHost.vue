<script setup>
/**
 * Toast 宿主：底部居中、2.5s 自动消失、aria-live="polite"、不阻挡操作。
 */
import { dismissToast, toastStore } from '../../stores/toast.js'
import Icon from './Icon.vue'
</script>

<template>
  <Teleport to="body">
    <div class="toast-layer" role="status" aria-live="polite" aria-atomic="false">
      <div
        v-for="item in toastStore.items"
        :key="item.id"
        class="toast"
        :class="{ 'toast-error': item.type === 'error' }"
        @click="dismissToast(item.id)"
      >
        <Icon v-if="item.type === 'success'" name="check" />
        <Icon v-else-if="item.type === 'error'" name="alert" />
        <span>{{ item.message }}</span>
      </div>
    </div>
  </Teleport>
</template>

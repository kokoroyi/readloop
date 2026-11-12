<script setup>
/**
 * 内联 SVG 图标：统一 stroke-width 1.8，不使用 emoji/图标字体/外链资源。
 * 图标以结构化几何数据声明（不用 v-html），保证模板安全。
 * 用法：<Icon name="book" :size="16" />
 */
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 }
})

const ICONS = {
  book: [
    {
      tag: 'path',
      d: 'M12 6.6C10.4 5.1 8.4 4.5 5.6 4.5H4v13h1.6c2.8 0 4.8.6 6.4 2.1 1.6-1.5 3.6-2.1 6.4-2.1H20v-13h-1.6c-2.8 0-4.8.6-6.4 2.1z'
    },
    { tag: 'path', d: 'M12 6.6v13' }
  ],
  'book-open': [
    {
      tag: 'path',
      d: 'M12 6.4C10.5 5 8.6 4.4 6 4.4H4.4v12.9H6c2.6 0 4.5.6 6 2 1.5-1.4 3.4-2 6-2h1.6V4.4H18c-2.6 0-4.5.6-6 2z'
    },
    { tag: 'path', d: 'M12 6.4v12.9' }
  ],
  sparkles: [
    {
      tag: 'path',
      d: 'M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7z'
    },
    {
      tag: 'path',
      d: 'M17.8 15.4l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z'
    }
  ],
  refresh: [
    { tag: 'path', d: 'M19.5 11.2a7.5 7.5 0 1 0-2.2 5.8' },
    { tag: 'path', d: 'M19.5 5.6v5.6h-5.6' }
  ],
  'rotate-cw': [
    { tag: 'path', d: 'M19.5 11.2a7.5 7.5 0 1 0-2.2 5.8' },
    { tag: 'path', d: 'M19.5 5.6v5.6h-5.6' }
  ],
  database: [
    { tag: 'ellipse', cx: 12, cy: 6, rx: 7, ry: 2.8 },
    {
      tag: 'path',
      d: 'M5 6v6c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6'
    },
    {
      tag: 'path',
      d: 'M5 12v6c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-6'
    }
  ],
  info: [
    { tag: 'circle', cx: 12, cy: 12, r: 8.4 },
    { tag: 'path', d: 'M12 11.2v5' },
    { tag: 'path', d: 'M12 8.1v.2' }
  ],
  sun: [
    { tag: 'circle', cx: 12, cy: 12, r: 4 },
    {
      tag: 'path',
      d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'
    }
  ],
  moon: [{ tag: 'path', d: 'M20.4 13.4A8.4 8.4 0 0 1 10.6 3.6a8.4 8.4 0 1 0 9.8 9.8z' }],
  check: [{ tag: 'path', d: 'M5 12.6l4.4 4.4L19 7.4' }],
  close: [{ tag: 'path', d: 'M6 6l12 12M18 6L6 18' }],
  'chevron-left': [{ tag: 'path', d: 'M15 18l-6-6 6-6' }],
  'chevron-right': [{ tag: 'path', d: 'M9 6l6 6-6 6' }],
  'chevron-down': [{ tag: 'path', d: 'M6 9l6 6 6-6' }],
  plus: [{ tag: 'path', d: 'M12 5v14M5 12h14' }],
  upload: [
    { tag: 'path', d: 'M12 16V4' },
    { tag: 'path', d: 'M6.5 9.5L12 4l5.5 5.5' },
    { tag: 'path', d: 'M4.5 19.5h15' }
  ],
  search: [
    { tag: 'circle', cx: 11, cy: 11, r: 6.4 },
    { tag: 'path', d: 'M15.8 15.8L20 20' }
  ],
  alert: [
    { tag: 'path', d: 'M12 4.5L21 19.5H3L12 4.5z' },
    { tag: 'path', d: 'M12 10.2v3.8' },
    { tag: 'path', d: 'M12 17.2v.2' }
  ],
  eye: [
    {
      tag: 'path',
      d: 'M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z'
    },
    { tag: 'circle', cx: 12, cy: 12, r: 3.2 }
  ],
  'eye-off': [
    { tag: 'path', d: 'M4 4l16 16' },
    {
      tag: 'path',
      d: 'M9.9 5.9A9.5 9.5 0 0 1 12 5.6c6 0 9.4 6.4 9.4 6.4a17 17 0 0 1-3 3.9'
    },
    {
      tag: 'path',
      d: 'M6.4 6.9A17 17 0 0 0 2.6 12S6 18.4 12 18.4c1.5 0 2.9-.4 4.1-1'
    },
    { tag: 'path', d: 'M10 10a3.2 3.2 0 0 0 4.2 4.2' }
  ],
  zap: [{ tag: 'path', d: 'M13 3L5 13.5h6L11 21l8-10.5h-6z' }],
  clock: [
    { tag: 'circle', cx: 12, cy: 12, r: 8.4 },
    { tag: 'path', d: 'M12 7.8V12l2.8 1.8' }
  ],
  'file-text': [
    { tag: 'path', d: 'M6.5 3.5h7l4 4v13h-11z' },
    { tag: 'path', d: 'M13.5 3.5v4h4' },
    { tag: 'path', d: 'M9 12h6M9 15.5h6' }
  ],
  type: [
    { tag: 'path', d: 'M5 6.5V5h14v1.5' },
    { tag: 'path', d: 'M12 5v14' },
    { tag: 'path', d: 'M9 19h6' }
  ],
  sliders: [
    { tag: 'path', d: 'M4 7h9' },
    { tag: 'path', d: 'M17 7h3' },
    { tag: 'circle', cx: 15, cy: 7, r: 2 },
    { tag: 'path', d: 'M4 17h3' },
    { tag: 'path', d: 'M11 17h9' },
    { tag: 'circle', cx: 9, cy: 17, r: 2 }
  ],
  settings: [
    { tag: 'circle', cx: 12, cy: 12, r: 3 },
    {
      tag: 'path',
      d: 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z'
    }
  ],
  spinner: [
    { tag: 'circle', cx: 12, cy: 12, r: 8.4, opacity: '.25' },
    { tag: 'path', d: 'M20.4 12a8.4 8.4 0 0 0-8.4-8.4' }
  ],
  bookmarks: [{ tag: 'path', d: 'M6.5 4.5h11v15l-5.5-3.6-5.5 3.6z' }],
  'arrow-right': [
    { tag: 'path', d: 'M5 12h14' },
    { tag: 'path', d: 'M13 6l6 6-6 6' }
  ],
  'external-link': [
    { tag: 'path', d: 'M14 4h6v6' },
    { tag: 'path', d: 'M20 4l-8.5 8.5' },
    { tag: 'path', d: 'M18 14v5H5V6h5' }
  ],
  'log-in': [
    { tag: 'path', d: 'M9 4.5H5.5v15H9' },
    { tag: 'path', d: 'M13 8l4 4-4 4' },
    { tag: 'path', d: 'M17 12H9' }
  ],
  more: [
    { tag: 'circle', cx: 5, cy: 12, r: 1 },
    { tag: 'circle', cx: 12, cy: 12, r: 1 },
    { tag: 'circle', cx: 19, cy: 12, r: 1 }
  ],
  'arrow-up': [
    { tag: 'path', d: 'M12 19V5' },
    { tag: 'path', d: 'M6 11l6-6 6 6' }
  ],
  'arrow-down': [
    { tag: 'path', d: 'M12 5v14' },
    { tag: 'path', d: 'M6 13l6 6 6-6' }
  ],
  'arrow-down-up': [
    { tag: 'path', d: 'M8 19V5' },
    { tag: 'path', d: 'M4.5 8.5L8 5l3.5 3.5' },
    { tag: 'path', d: 'M16 5v14' },
    { tag: 'path', d: 'M12.5 15.5L16 19l3.5-3.5' }
  ],
  pin: [
    { tag: 'path', d: 'M9.2 4.5h5.6' },
    { tag: 'path', d: 'M12 4.5v4.8' },
    { tag: 'path', d: 'M8.3 9.3h7.4l-1.1 4.6H9.4z' },
    { tag: 'path', d: 'M12 13.9v5.6' }
  ],
  trash: [
    { tag: 'path', d: 'M4.5 7.5h15' },
    { tag: 'path', d: 'M9.5 7.5V5.5h5v2' },
    { tag: 'path', d: 'M6.5 7.5l1 12h9l1-12' },
    { tag: 'path', d: 'M10.5 11v5M13.5 11v5' }
  ],
  download: [
    { tag: 'path', d: 'M12 4v12' },
    { tag: 'path', d: 'M6.5 10.5L12 16l5.5-5.5' },
    { tag: 'path', d: 'M4.5 19.5h15' }
  ],
  folder: [
    {
      tag: 'path',
      d: 'M4 6.5A1.5 1.5 0 0 1 5.5 5H10l2 2.5h6.5A1.5 1.5 0 0 1 20 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z'
    }
  ],
  'arrow-up-right': [
    { tag: 'path', d: 'M7 17L17 7' },
    { tag: 'path', d: 'M8 7h9v9' }
  ],
  send: [
    { tag: 'path', d: 'M20.5 3.5L3.5 10.5l6.4 2.6 2.6 6.4z' },
    { tag: 'path', d: 'M20.5 3.5L9.9 13.1' }
  ]
}

const shapes = computed(() => ICONS[props.name] || [])
const sizeValue = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <svg
    :width="sizeValue"
    :height="sizeValue"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-for="(shape, index) in shapes" :key="index">
      <circle
        v-if="shape.tag === 'circle'"
        :cx="shape.cx"
        :cy="shape.cy"
        :r="shape.r"
        :opacity="shape.opacity"
      />
      <ellipse
        v-else-if="shape.tag === 'ellipse'"
        :cx="shape.cx"
        :cy="shape.cy"
        :rx="shape.rx"
        :ry="shape.ry"
      />
      <path v-else :d="shape.d" :opacity="shape.opacity" />
    </template>
  </svg>
</template>

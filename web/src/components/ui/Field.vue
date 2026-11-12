<script setup>
/**
 * 表单项容器：label / hint / error 就地展示，并向控件透传 id 与无障碍属性。
 * 用法：
 * <Field label="接口地址" :error="errors.baseUrl" required v-slot="{ id, invalid, describedby }">
 *   <input :id="id" v-model="draft.baseUrl" class="input" :aria-invalid="invalid" :aria-describedby="describedby" />
 * </Field>
 */
import { computed, useId } from 'vue'

const props = defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  required: { type: Boolean, default: false },
  forId: { type: String, default: '' }
})

const uid = useId()
const controlId = computed(() => props.forId || `rl-field-${uid}`)
const hintId = computed(() => `${controlId.value}-hint`)
const errorId = computed(() => `${controlId.value}-error`)
const invalid = computed(() => Boolean(props.error))
const describedby = computed(() => (invalid.value ? errorId.value : props.hint ? hintId.value : undefined))
</script>

<template>
  <div class="field">
    <label v-if="label" class="label" :for="controlId">
      {{ label }}<span v-if="required" class="label-req" aria-hidden="true">*</span>
    </label>
    <slot :id="controlId" :invalid="invalid" :describedby="describedby" :hint-id="hintId" :error-id="errorId" />
    <p v-if="error" :id="errorId" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="hint" :id="hintId" class="hint">{{ hint }}</p>
  </div>
</template>

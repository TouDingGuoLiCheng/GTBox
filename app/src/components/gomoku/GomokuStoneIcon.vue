<script setup lang="ts">
withDefaults(
  defineProps<{
    color?: "black" | "white";
    mode?: "pvc" | "pvp" | "cvc" | "settings" | "lan";
    /** card：首页工具卡片，扁平单色棋子，适配 accent 底框 */
    variant?: "default" | "card";
    size?: number;
  }>(),
  { size: 40, variant: "default" },
);
</script>

<template>
  <!-- 工具卡片：与其它插件一致的扁平图标风 -->
  <svg
    v-if="variant === 'card'"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    class="shrink-0 text-accent"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8" fill="#18181b" />
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.75" />
  </svg>

  <svg
    v-else
    :width="size"
    :height="size"
    :viewBox="mode ? '0 0 64 64' : '0 0 40 40'"
    class="shrink-0"
    aria-hidden="true"
  >
    <template v-if="mode === 'pvc'">
      <circle cx="22" cy="32" r="14" fill="#0a0a0a" stroke="#333" stroke-width="1.5" />
      <circle cx="42" cy="24" r="11" fill="#f4f4f4" stroke="#999" stroke-width="1.5" />
      <rect x="30" y="28" width="6" height="2" rx="1" fill="currentColor" class="text-accent" opacity="0.85" />
    </template>
    <template v-else-if="mode === 'pvp'">
      <circle cx="20" cy="32" r="13" fill="#0a0a0a" stroke="#333" stroke-width="1.5" />
      <circle cx="44" cy="32" r="13" fill="#f4f4f4" stroke="#999" stroke-width="1.5" />
    </template>
    <template v-else-if="mode === 'cvc'">
      <circle cx="20" cy="32" r="12" fill="#888" stroke="#666" stroke-width="1.5" />
      <circle cx="44" cy="32" r="12" fill="#aaa" stroke="#777" stroke-width="1.5" />
    </template>
    <template v-else-if="mode === 'settings'">
      <circle cx="24" cy="34" r="12" fill="#0a0a0a" stroke="#333" stroke-width="1.5" />
      <circle cx="40" cy="28" r="10" fill="#f4f4f4" stroke="#999" stroke-width="1.5" />
      <circle
        cx="32"
        cy="20"
        r="9"
        fill="none"
        stroke="currentColor"
        class="text-accent"
        stroke-width="1.8"
        opacity="0.9"
      />
      <line
        x1="32"
        y1="12"
        x2="32"
        y2="14.5"
        stroke="currentColor"
        class="text-accent"
        stroke-width="1.8"
        stroke-linecap="round"
        opacity="0.9"
      />
      <line
        x1="32"
        y1="25.5"
        x2="32"
        y2="28"
        stroke="currentColor"
        class="text-accent"
        stroke-width="1.8"
        stroke-linecap="round"
        opacity="0.9"
      />
      <line
        x1="24.5"
        y1="20"
        x2="27"
        y2="20"
        stroke="currentColor"
        class="text-accent"
        stroke-width="1.8"
        stroke-linecap="round"
        opacity="0.9"
      />
      <line
        x1="37"
        y1="20"
        x2="39.5"
        y2="20"
        stroke="currentColor"
        class="text-accent"
        stroke-width="1.8"
        stroke-linecap="round"
        opacity="0.9"
      />
    </template>
    <template v-else-if="mode === 'lan'">
      <circle cx="16" cy="32" r="11" fill="#0a0a0a" stroke="#333" stroke-width="1.5" />
      <circle cx="48" cy="32" r="11" fill="#f4f4f4" stroke="#999" stroke-width="1.5" />
      <line
        x1="27"
        y1="32"
        x2="37"
        y2="32"
        stroke="currentColor"
        class="text-accent"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="3 3"
        opacity="0.85"
      />
      <circle cx="32" cy="32" r="2.2" fill="currentColor" class="text-accent" opacity="0.9" />
    </template>
    <template v-else>
      <circle
        cx="20"
        cy="20"
        r="17"
        :fill="color === 'white' ? '#f4f4f4' : '#0a0a0a'"
        :stroke="color === 'white' ? '#999' : '#333'"
        stroke-width="2"
      />
      <ellipse
        cx="16"
        cy="14"
        rx="5"
        ry="3"
        :fill="color === 'white' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.12)'"
      />
    </template>
  </svg>
</template>

<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { ref } from "vue";
import type { NodeType } from "../../../types/ruleGraph";
import { getNodeDef, PALETTE_GROUPS } from "../../../utils/ruleGraph/nodeDefs";

const emit = defineEmits<{
  pickStart: [type: NodeType, event: PointerEvent];
  pickEnd: [];
}>();

const collapsed = ref<Record<string, boolean>>({});

function isGroupOpen(title: string): boolean {
  return collapsed.value[title] !== true;
}

function toggleGroup(title: string) {
  collapsed.value[title] = !collapsed.value[title];
}

function onPointerDown(event: PointerEvent, type: NodeType) {
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  emit("pickStart", type, event);
}

function onPointerUp(event: PointerEvent) {
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }
  emit("pickEnd");
}
</script>

<template>
  <div class="palette-scroll">
    <div v-for="group in PALETTE_GROUPS" :key="group.title" class="palette-group">
      <button type="button" class="group-header" @click="toggleGroup(group.title)">
        <Icon
          :icon="isGroupOpen(group.title) ? 'mdi:chevron-down' : 'mdi:chevron-right'"
          class="shrink-0 text-zinc-500"
        />
        <span class="truncate">{{ group.title }}</span>
      </button>
      <div v-show="isGroupOpen(group.title)" class="group-items">
        <button
          v-for="type in group.types"
          :key="type"
          type="button"
          class="palette-item ui-matte-chip"
          @pointerdown="onPointerDown($event, type)"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <Icon icon="mdi:plus-box-outline" class="shrink-0 text-zinc-500" />
          <span class="min-w-0 truncate text-left">{{ getNodeDef(type).label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-scroll {
  max-height: min(22rem, calc(100vh - 18rem));
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0.375rem;
  scrollbar-width: thin;
  scrollbar-color: rgb(63 63 70) transparent;
}
.palette-scroll::-webkit-scrollbar {
  width: 5px;
}
.palette-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgb(63 63 70);
}
.palette-group + .palette-group {
  margin-top: 0.375rem;
}
.group-header {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.375rem;
  padding: 0.25rem 0.125rem;
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgb(113 113 122);
  transition: color 0.15s, background 0.15s;
}
.group-header:hover {
  color: rgb(161 161 170);
  background: rgb(255 255 255 / 0.03);
}
.group-items {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.125rem 0 0.25rem 0.375rem;
}
.palette-item {
  display: flex;
  width: 100%;
  cursor: grab;
  touch-action: none;
  user-select: none;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.375rem;
  border: 1px solid rgb(39 39 42);
  background: rgb(0 0 0 / 0.25);
  padding: 0.3rem 0.375rem;
  font-size: 0.6875rem;
  color: rgb(212 212 216);
  transition: background 0.15s, border-color 0.15s;
}
.palette-item:hover {
  border-color: color-mix(in srgb, var(--color-accent) 40%, rgb(39 39 42));
  background: rgb(255 255 255 / 0.05);
}
.palette-item:active {
  cursor: grabbing;
}
</style>

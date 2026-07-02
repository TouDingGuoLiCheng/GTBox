<script setup lang="ts">
import { Icon } from "@iconify/vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import type { RuleGraph } from "../../types/ruleGraph";
import { useRegexBuilderTemplatesStore } from "../../stores/regexBuilderTemplates";
import {
  FORMAT_TEMPLATE_DEFS,
  createFormatTemplateGraph,
  type FormatTemplateMenuItem,
} from "../../utils/ruleGraph/formatTemplates";
import { pushDebugLine } from "../../utils/mediaDebug";

const props = defineProps<{
  graph: RuleGraph;
}>();

const emit = defineEmits<{
  load: [graph: RuleGraph];
}>();

const store = useRegexBuilderTemplatesStore();
const open = ref(false);
const rootRef = useTemplateRef<HTMLElement>("rootRef");
const triggerRef = useTemplateRef<HTMLButtonElement>("triggerRef");
const menuRef = useTemplateRef<HTMLElement>("menuRef");
const menuPos = ref({ top: 0, left: 0 });

const saveDialogOpen = ref(false);
const saveName = ref("");
const saveInputRef = useTemplateRef<HTMLInputElement>("saveInputRef");

const deleteTarget = ref<{ id: string; name: string } | null>(null);

const builtin = FORMAT_TEMPLATE_DEFS;

function updateMenuPosition() {
  const el = triggerRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  menuPos.value = { top: rect.bottom + 4, left: rect.left };
}

function toggleOpen() {
  open.value = !open.value;
  if (open.value) {
    nextTick(() => updateMenuPosition());
  }
}

function loadBuiltin(item: FormatTemplateMenuItem) {
  const graph = createFormatTemplateGraph(item.id, item.variant);
  pushDebugLine("正则生成", "template-load", item.label, {
    kind: "builtin",
    id: item.id,
    variant: item.variant,
  });
  emit("load", graph);
  open.value = false;
}

function loadUser(id: string) {
  const item = store.userTemplates.find((t) => t.id === id);
  if (!item) return;
  pushDebugLine("正则生成", "template-load", item.name, { kind: "user", id });
  emit("load", JSON.parse(JSON.stringify(item.graph)) as RuleGraph);
  open.value = false;
}

function openSaveDialog() {
  saveName.value = "";
  saveDialogOpen.value = true;
  open.value = false;
  nextTick(() => saveInputRef.value?.focus());
}

function confirmSave() {
  const trimmed = saveName.value.trim();
  if (!trimmed) return;
  store.saveTemplate(trimmed, props.graph);
  saveDialogOpen.value = false;
}

function onSaveKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    confirmSave();
  }
}

function askRemoveUser(id: string, name: string, event: Event) {
  event.stopPropagation();
  deleteTarget.value = { id, name };
  open.value = false;
}

function confirmDelete() {
  if (!deleteTarget.value) return;
  store.removeTemplate(deleteTarget.value.id);
  deleteTarget.value = null;
}

function onDocClick(event: MouseEvent) {
  const target = event.target as Node;
  if (open.value) {
    if (rootRef.value?.contains(target) || menuRef.value?.contains(target)) return;
    open.value = false;
  }
}

function onViewportChange() {
  if (open.value) updateMenuPosition();
}

watch(open, (value) => {
  if (value) nextTick(() => updateMenuPosition());
});

onMounted(() => {
  document.addEventListener("click", onDocClick);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
});

const hasUser = computed(() => store.userTemplates.length > 0);
</script>

<template>
  <div ref="rootRef" class="relative inline-flex items-center gap-0.5">
    <button
      ref="triggerRef"
      type="button"
      class="icon-btn ui-matte-chip"
      :class="{ 'icon-btn--active': open }"
      title="模板"
      @click.stop="toggleOpen"
    >
      <Icon icon="mdi:file-tree-outline" class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="icon-btn ui-matte-chip"
      title="存为模板"
      @click.stop="openSaveDialog"
    >
      <Icon icon="mdi:content-save-outline" class="h-4 w-4" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="menuRef"
        class="fixed z-[300] min-w-[10rem] overflow-hidden rounded-lg border border-border bg-zinc-900/95 py-1 shadow-xl backdrop-blur-md"
        :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
        @click.stop
      >
        <button
          v-for="item in builtin"
          :key="`${item.id}-${item.variant}`"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-white/5"
          @click="loadBuiltin(item)"
        >
          <Icon :icon="item.icon" class="shrink-0 text-base text-zinc-500" />
          {{ item.label }}
        </button>

        <template v-if="hasUser">
          <div class="my-1 border-t border-border" />
          <div
            v-for="item in store.userTemplates"
            :key="item.id"
            class="group flex w-full items-center gap-1 hover:bg-white/5"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300"
              @click="loadUser(item.id)"
            >
              <Icon icon="mdi:bookmark-outline" class="shrink-0 text-base text-zinc-500" />
              <span class="truncate">{{ item.name }}</span>
            </button>
            <button
              type="button"
              class="mr-1 rounded p-0.5 text-zinc-600 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100"
              title="删除"
              @click="askRemoveUser(item.id, item.name, $event)"
            >
              <Icon icon="mdi:close" class="text-sm" />
            </button>
          </div>
        </template>
      </div>

      <Transition name="tpl-dialog">
        <div
          v-if="saveDialogOpen"
          class="fixed inset-0 z-[400] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          @click.self="saveDialogOpen = false"
        >
          <div
            class="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-[#121214] shadow-2xl"
            role="dialog"
            aria-labelledby="save-template-title"
            @click.stop
          >
            <header class="flex items-center gap-2 border-b border-border px-4 py-3">
              <Icon icon="mdi:content-save-outline" class="text-lg text-accent" />
              <h2 id="save-template-title" class="text-sm font-medium text-zinc-100">存为模板</h2>
            </header>
            <div class="space-y-3 px-4 py-4">
              <label class="block text-xs text-zinc-500" for="template-name-input">模板名称</label>
              <input
                id="template-name-input"
                ref="saveInputRef"
                v-model="saveName"
                type="text"
                class="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
                placeholder="例如：订单号提取"
                @keydown="onSaveKeydown"
              />
            </div>
            <footer class="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                class="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
                @click="saveDialogOpen = false"
              >
                取消
              </button>
              <button
                type="button"
                class="rounded-lg bg-accent/90 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-accent disabled:opacity-40"
                :disabled="!saveName.trim()"
                @click="confirmSave"
              >
                保存
              </button>
            </footer>
          </div>
        </div>
      </Transition>

      <Transition name="tpl-dialog">
        <div
          v-if="deleteTarget"
          class="fixed inset-0 z-[400] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          @click.self="deleteTarget = null"
        >
          <div
            class="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-[#121214] shadow-2xl"
            role="alertdialog"
            aria-labelledby="delete-template-title"
            @click.stop
          >
            <header class="flex items-center gap-2 border-b border-border px-4 py-3">
              <Icon icon="mdi:delete-outline" class="text-lg text-rose-400" />
              <h2 id="delete-template-title" class="text-sm font-medium text-zinc-100">删除模板</h2>
            </header>
            <p class="px-4 py-4 text-sm text-zinc-400">
              确定删除「<span class="text-zinc-200">{{ deleteTarget.name }}</span>」？
            </p>
            <footer class="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                class="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
                @click="deleteTarget = null"
              >
                取消
              </button>
              <button
                type="button"
                class="rounded-lg bg-rose-500/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-500"
                @click="confirmDelete"
              >
                删除
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 0.25);
  color: rgb(212 212 216);
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover {
  background: rgb(255 255 255 / 0.06);
}
.icon-btn--active {
  border-color: color-mix(in srgb, var(--color-accent) 55%, rgb(39 39 42));
  background: color-mix(in srgb, var(--color-accent) 12%, rgb(0 0 0 / 0.25));
  color: var(--color-accent);
}

.tpl-dialog-enter-active,
.tpl-dialog-leave-active {
  transition: opacity 0.18s ease;
}
.tpl-dialog-enter-active > div:last-child,
.tpl-dialog-leave-active > div:last-child {
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.tpl-dialog-enter-from,
.tpl-dialog-leave-to {
  opacity: 0;
}
.tpl-dialog-enter-from > div:last-child,
.tpl-dialog-leave-to > div:last-child {
  transform: scale(0.97) translateY(4px);
  opacity: 0;
}
</style>

<script setup lang="ts">

import { Icon } from "@iconify/vue";

import { ref } from "vue";

import { useRouter } from "vue-router";

import RegexOutputPanel from "../components/regexBuilder/RegexOutputPanel.vue";

import RegexTemplateMenu from "../components/regexBuilder/RegexTemplateMenu.vue";

import RegexTestPanel from "../components/regexBuilder/RegexTestPanel.vue";

import RuleGraphEditor from "../components/textCompare/ruleGraph/RuleGraphEditor.vue";

import type { RuleGraph } from "../types/ruleGraph";

import { createDefaultRuleGraph } from "../utils/ruleGraph";



const router = useRouter();

const ruleGraph = ref<RuleGraph>(createDefaultRuleGraph());



function onLoadTemplate(graph: RuleGraph) {

  ruleGraph.value = graph;

}

</script>



<template>

  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5">

    <div class="mb-3 flex shrink-0 items-center justify-between gap-3">

      <button

        type="button"

        class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-accent"

        @click="router.push('/')"

      >

        <Icon icon="mdi:arrow-left" />

        返回首页

      </button>

      <div class="flex items-center gap-2 text-sm text-zinc-500">

        <Icon icon="mdi:regex" class="text-lg text-accent" />

        <span>正则表达式生成</span>

      </div>

    </div>



    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4">

      <section

        class="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50"

        style="min-height: 32rem"

      >

        <div class="shrink-0 border-b border-border px-4 py-2.5 text-sm font-medium text-zinc-300">

          规则图

        </div>

        <div class="min-h-0 flex-1 p-3">

          <RuleGraphEditor v-model="ruleGraph" variant="builder">

            <template #toolbar-extra>

              <RegexTemplateMenu :graph="ruleGraph" @load="onLoadTemplate" />

            </template>

          </RuleGraphEditor>

        </div>

      </section>



      <section class="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50">

        <div class="shrink-0 border-b border-border px-4 py-2.5 text-sm font-medium text-zinc-300">

          测试

        </div>

        <RegexTestPanel :graph="ruleGraph" />

      </section>



      <section class="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated/50">

        <div class="shrink-0 border-b border-border px-4 py-2.5 text-sm font-medium text-zinc-300">

          输出

        </div>

        <RegexOutputPanel :graph="ruleGraph" />

      </section>

    </div>

  </div>

</template>


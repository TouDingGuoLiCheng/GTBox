import { createApp } from "vue";
import { createPinia } from "pinia";
import { MotionPlugin } from "@vueuse/motion";
import { invoke } from "@tauri-apps/api/core";
import App from "./App.vue";
import router from "./router";
import { useAppearanceStore } from "./stores/appearance";
import { checkInstallHealthOnStartup } from "./utils/installHealth";
import "./assets/main.css";
import "./styles/app-brand.css";
import "./styles/desktop-peek.css";
import "./styles/pixel-fonts.css";
import "./styles/galaxy-theme.css";
import "./styles/galaxy-ui-material.css";
import "./styles/pixel-theme.css";
import "./styles/pixel-ui-material.css";
import "./styles/skin-preset.css";

const pinia = createPinia();
const app = createApp(App);
app.use(pinia);
app.use(router);
app.use(MotionPlugin);

const appearance = useAppearanceStore(pinia);
void invoke("clear_runtime_cache").catch(() => undefined);
void appearance.init().then(() => checkInstallHealthOnStartup());

router.beforeEach((to) => {
  appearance.setToolAudioSuppressed(to.meta.suppressSkinBgm === true);
});

app.mount("#app");

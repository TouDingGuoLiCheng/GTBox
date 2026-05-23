import { createApp } from "vue";
import { createPinia } from "pinia";
import { MotionPlugin } from "@vueuse/motion";
import App from "./App.vue";
import router from "./router";
import { useAppearanceStore } from "./stores/appearance";
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

useAppearanceStore(pinia).init();

app.mount("#app");

import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";

export interface InstallHealth {
  mode: string;
  ok: boolean;
  message?: string | null;
  pluginsOk: boolean;
  workspacesOk: boolean;
}

export async function checkInstallHealthOnStartup() {
  try {
    const health = await invoke<InstallHealth>("check_install_health");
    if (!health.ok && health.message) {
      await message(health.message, { title: "GTBox 资源不完整", kind: "warning" });
    }
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}

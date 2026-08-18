import { Notice } from "obsidian";
import { t } from "./i18n";

declare function require(name: string): any;

/**
 * 复制文本到剪贴板。
 * Obsidian（Electron）环境优先用 electron.clipboard（最可靠，避免
 * navigator.clipboard 在桌面端“提示成功但实际没写进剪贴板”的问题）；
 * 其次 navigator.clipboard（移动端 WebView 可用时）；最后 execCommand 兜底。
 */
export async function copyText(text: string): Promise<void> {
  // 1. Electron clipboard（Obsidian 桌面端）
  try {
    const electron = require("electron") as {
      clipboard?: { writeText: (t: string) => void };
    };
    if (electron?.clipboard) {
      electron.clipboard.writeText(text);
      new Notice(t("common.copied"));
      return;
    }
  } catch {
    // 继续走下一步
  }

  // 2. 浏览器 clipboard API（移动端 WebView）
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(t("common.copied"));
      return;
    } catch {
      // 继续走回退
    }
  }

  // 3. execCommand 兜底
  try {
    const ta = document.body.createEl("textarea", {
      cls: "ai-copy-helper",
    });
    ta.value = text;
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) new Notice(t("common.copied"));
    else new Notice(t("common.copy_failed"));
  } catch {
    new Notice(t("common.copy_failed"));
  }
}

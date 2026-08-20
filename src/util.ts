import { Notice } from "obsidian";
import { t } from "./i18n";

declare function require(name: string): any;

/**
 * 复制文本到剪贴板，写入后读回验证（验证必须用 navigator.clipboard.readText
 * 才能确认系统剪贴板真的有内容，electron.clipboard 在新版 Obsidian 沙箱里是
 * “插件剪贴板”，验证过但系统 Cmd+V 读不到——本函数就是要避开这个坑）。
 * 桌面端优先 navigator.clipboard（写到系统剪贴板），其次 electron + execCommand 兜底。
 */
export async function copyText(text: string): Promise<void> {
  // 1. 浏览器 Clipboard API（桌面/移动 Electron 都会写到系统剪贴板，前提是文档已聚焦——按钮点击时已聚焦）
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      // 读回验证（navigator 读的就是系统剪贴板）
      try {
        const got = await navigator.clipboard.readText();
        if (got === text) {
          new Notice(t("common.copied"));
          return;
        }
      } catch {
        // readText 无权限（罕见），退回到 execCommand 验证
      }
    } catch {
      // writeText 被拒（聚焦/权限问题），继续下一步
    }
  }

  // 2. execCommand 兜底（写后用 navigator.readText 验证系统剪贴板）
  try {
    const ta = document.body.createEl("textarea", {
      cls: "ai-copy-helper",
    });
    ta.value = text;
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok && navigator.clipboard && window.isSecureContext) {
      try {
        const got = await navigator.clipboard.readText();
        if (got === text) {
          new Notice(t("common.copied"));
          return;
        }
      } catch {
        // 无法读回验证，但 execCommand 成功了，先信任
        new Notice(t("common.copied"));
        return;
      }
    }
    if (ok) {
      new Notice(t("common.copied"));
      return;
    }
    new Notice(t("common.copy_failed"));
  } catch {
    new Notice(t("common.copy_failed"));
  }
}

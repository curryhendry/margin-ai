import { Notice } from "obsidian";
import { t } from "./i18n";

declare function require(name: string): any;

/**
 * 读取当前剪贴板内容（同步，仅桌面 Electron 环境可用）。
 * 移动端 / 无 electron 时返回空串，调用方需自行处理"无法校验"的情况。
 */
function readClipboard(): string {
  try {
    const electron = require("electron");
    if (electron?.clipboard) return electron.clipboard.readText();
  } catch {
    // 非 Electron 环境（移动端）
  }
  return "";
}

/**
 * 复制文本到剪贴板，写入后读回验证，避免"提示已复制但实际没复制"的误报。
 *
 * 三级通道，逐级兜底：
 *   1. electron.clipboard —— 桌面端最可靠，同步写 + 同步读回校验
 *   2. navigator.clipboard —— 移动端主通道，readText 无权限时信任 writeText
 *   3. execCommand("copy") —— 最后兜底，用 readClipboard 校验结果
 * 只有确认写入成功才提示 copied，否则提示 copy_failed。
 */
export async function copyText(text: string): Promise<void> {
  // 1. Electron 剪贴板（桌面端优先，同步可校验）
  try {
    const electron = require("electron");
    if (electron?.clipboard) {
      electron.clipboard.writeText(text);
      if (electron.clipboard.readText() === text) {
        new Notice(t("common.copied"));
        return;
      }
    }
  } catch {
    // 非 Electron 环境，继续下一步
  }

  // 2. 浏览器 Clipboard API（移动端主通道；需文档已聚焦，按钮点击时满足）
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      let ok = true;
      try {
        const got = await navigator.clipboard.readText();
        ok = got === text;
      } catch {
        // readText 无权限（移动端常见），writeText 已成功则信任
        ok = true;
      }
      if (ok) {
        new Notice(t("common.copied"));
        return;
      }
    } catch {
      // writeText 被拒（聚焦/权限问题），继续下一步
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
    const verified = ok && readClipboard() === text;
    new Notice(verified ? t("common.copied") : t("common.copy_failed"));
  } catch {
    new Notice(t("common.copy_failed"));
  }
}

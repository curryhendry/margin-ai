import { Notice, Platform } from "obsidian";
import { t } from "./i18n";

declare function require(name: string): any;

/**
 * 获取 Electron 剪贴板（仅桌面端）。不可用时返回 null。
 */
function electronClipboard(): any | null {
  try {
    const electron = require("electron");
    return electron?.clipboard ?? null;
  } catch {
    return null;
  }
}

/**
 * 浏览器 Clipboard API（移动端主通道）。
 * 注意：Obsidian 桌面端在 app:// 安全上下文下 writeText 可能「假成功」
 * （Promise resolve 但未写入系统剪贴板），因此桌面端绝不走此通道。
 */
async function copyViaNavigator(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 无权限 / 聚焦问题，返回失败走兜底
  }
  return false;
}

/**
 * execCommand 兜底：隐藏 textarea + 选中 + copy。
 * 返回 true 即浏览器确认复制动作执行成功（经典可靠做法）。
 */
function copyViaExecCommand(text: string): boolean {
  try {
    const ta = document.body.createEl("textarea", {
      cls: "ai-copy-helper",
    });
    ta.value = text;
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * 复制文本到剪贴板。
 * 桌面端：Electron 剪贴板（同步+回读校验）→ execCommand 兜底，绝不走 navigator.clipboard。
 * 移动端：navigator.clipboard → execCommand 兜底。
 * 只有确认成功才提示 copied，否则提示 copy_failed。
 */
export async function copyText(text: string): Promise<void> {
  // 桌面端：Electron 同步可靠，可回读校验
  if (Platform.isDesktop) {
    const cb = electronClipboard();
    if (cb) {
      try {
        cb.writeText(text);
        if (cb.readText() === text) {
          new Notice(t("common.copied"));
          return;
        }
      } catch {
        // 读回异常，继续兜底
      }
    }
    if (copyViaExecCommand(text)) {
      new Notice(t("common.copied"));
      return;
    }
    new Notice(t("common.copy_failed"));
    return;
  }

  // 移动端：浏览器 Clipboard API → execCommand 兜底
  if (await copyViaNavigator(text)) {
    new Notice(t("common.copied"));
    return;
  }
  if (copyViaExecCommand(text)) {
    new Notice(t("common.copied"));
    return;
  }
  new Notice(t("common.copy_failed"));
}

import { Notice } from "obsidian";
import { t } from "./i18n";

declare function require(name: string): any;

/** 读取系统剪贴板（Electron 桌面端）；不可用时返回空串 */
function readClipboard(): string {
  try {
    const electron = require("electron") as {
      clipboard?: { readText: () => string };
    };
    if (electron?.clipboard) return electron.clipboard.readText();
  } catch {
    // 忽略
  }
  return "";
}

/**
 * 复制文本到剪贴板，写入后读回验证，避免“提示成功但没复制”。
 * 桌面端优先 Electron clipboard（最可靠），其次 navigator.clipboard，最后 execCommand 兜底。
 * 每步都读回校验，校验不过就继续下一步；全部失败才提示失败。
 */
export async function copyText(text: string): Promise<void> {
  // 1. Electron clipboard（Obsidian 桌面端）——写入 + 读回验证
  try {
    const electron = require("electron") as {
      clipboard?: { writeText: (t: string) => void; readText: () => string };
    };
    if (electron?.clipboard) {
      electron.clipboard.writeText(text);
      if (electron.clipboard.readText() === text) {
        new Notice(t("common.copied"));
        return;
      }
      // 验证失败 → 继续
    }
  } catch {
    // 继续
  }

  // 2. 浏览器 clipboard API（移动端 WebView）
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      // 能读回则验证；读不了（移动端可能无权限）则信任写入成功
      let ok = true;
      try {
        const got = await navigator.clipboard.readText();
        ok = got === text;
      } catch {
        ok = true;
      }
      if (ok) {
        new Notice(t("common.copied"));
        return;
      }
    } catch {
      // 继续
    }
  }

  // 3. execCommand 兜底 + 读回验证
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

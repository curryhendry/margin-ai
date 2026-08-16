import { Notice } from "obsidian";

/**
 * 复制文本到剪贴板，兼容移动端：
 * 移动端 WebView 的 navigator.clipboard 可能不可用/被权限限制，
 * 失败时回退到 execCommand("copy")。
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      new Notice("已复制");
      return;
    } catch {
      // 继续走回退
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
    new Notice("已复制");
  } catch {
    new Notice("复制失败");
  }
}
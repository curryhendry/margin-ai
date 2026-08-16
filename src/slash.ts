import { Editor, Plugin } from "obsidian";

const Z_TOP = 2147483000;

/**
 * `/p` 斜杠命令：在编辑器中输入 `/p`，光标旁弹出一个小菜单，
 * 点击后打开 Margin 悬浮对话（保留当前选区）。
 *
 * Obsidian 没有公开的斜杠命令注册 API，这里监听 `editor-change` 手动实现：
 * 行内文本以 `/p` 结尾时弹出菜单，其它情况自动隐藏。
 */
export function registerSlashCommand(
  plugin: Plugin,
  openPopover: (editor: Editor, selected: string) => void
): void {
  let menu: HTMLElement | null = null;
  let pending: { editor: Editor; line: number; ch: number } | null = null;

  const close = (): void => {
    menu?.remove();
    menu = null;
    pending = null;
  };

  const placeMenu = (editor: Editor, line: number, ch: number): void => {
    pending = { editor, line, ch };
    if (menu) menu.remove();
    menu = document.body.createDiv({ cls: "ai-slash-menu" });
    menu.style.zIndex = String(Z_TOP);

    const item = menu.createDiv({ cls: "ai-slash-item" });
    item.createSpan({ text: "✦ Margin 悬浮对话" });
    item.addEventListener("click", () => {
      const p = pending;
      close();
      if (!p) return;
      // 移除已输入的 "/p"
      p.editor.replaceRange(
        "",
        { line: p.line, ch: p.ch - 2 },
        { line: p.line, ch: p.ch }
      );
      openPopover(p.editor, p.editor.getSelection());
    });

    // 定位到 DOM 光标附近
    const sel = window.getSelection();
    let left = 120;
    let top = 120;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r && (r.width > 0 || r.height > 0)) {
        left = Math.max(8, r.left);
        top = Math.max(8, r.bottom + 6);
      }
    }
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  };

  plugin.registerEvent(
    plugin.app.workspace.on("editor-change", (editor: Editor) => {
      const cursor = editor.getCursor();
      if (cursor.ch < 2) {
        if (menu) close();
        return;
      }
      const lineText = editor.getLine(cursor.line).slice(0, cursor.ch);
      if (lineText.endsWith("/p")) {
        placeMenu(editor, cursor.line, cursor.ch);
      } else if (menu) {
        close();
      }
    })
  );

  plugin.registerDomEvent(document, "keydown", (e) => {
    if (e.key === "Escape") close();
  });
  plugin.registerDomEvent(document, "mousedown", (e) => {
    if (menu && !menu.contains(e.target as Node)) close();
  });
}
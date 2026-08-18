import { App, TFile, setIcon } from "obsidian";

/**
 * Obsidian 风格的 [[ 笔记补全：
 * 输入 [[ 时在输入框上方弹出候选列表，方向键选择，Enter/Tab 确认，Esc 关闭。
 * 选中后通过 onPick 回调把选中的笔记交回给调用方（插入链接 + 显示关联标签）。
 */
export class NoteLinkSuggest {
  private app: App;
  private input: HTMLTextAreaElement;
  private onPick: (file: TFile, match: { start: number; end: number }) => void;
  private el: HTMLElement | null = null;
  private items: TFile[] = [];
  private selected = 0;
  private match: { start: number; end: number } | null = null;

  constructor(
    app: App,
    input: HTMLTextAreaElement,
    onPick: (file: TFile, match: { start: number; end: number }) => void
  ) {
    this.app = app;
    this.input = input;
    this.onPick = onPick;
    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("keydown", (e) => this.onKeydown(e));
    this.input.addEventListener("scroll", () => this.close());
    document.addEventListener("mousedown", (e) => {
      if (this.el && !this.el.contains(e.target as Node)) this.close();
    });
  }

  /** 找到光标前未闭合的 [[ 前缀 */
  private findMatch(): { start: number; end: number; query: string } | null {
    const pos = this.input.selectionStart ?? this.input.value.length;
    const text = this.input.value.slice(0, pos);
    const start = text.lastIndexOf("[[");
    if (start < 0) return null;
    const after = text.slice(start + 2);
    if (after.includes("]]")) return null;
    if (after.includes("\n")) return null;
    return { start, end: pos, query: after };
  }

  private refresh(): void {
    const m = this.findMatch();
    if (!m) {
      this.close();
      return;
    }
    const q = m.query.toLowerCase();
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !q || f.basename.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.basename.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.basename.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.basename.localeCompare(b.basename);
      })
      .slice(0, 8);
    if (files.length === 0) {
      this.close();
      return;
    }
    this.match = { start: m.start, end: m.end };
    this.items = files;
    this.selected = 0;
    this.render();
  }

  private render(): void {
    if (!this.el) {
      this.el = document.body.createDiv({ cls: "ai-link-suggest" });
    }
    this.el.empty();
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      const item = this.el.createDiv({
        cls: "ai-link-suggest-item" + (i === this.selected ? " is-selected" : ""),
        attr: { "data-path": f.path },
      });
      const icon = item.createSpan({ cls: "ai-link-suggest-item-icon" });
      setIcon(icon, "file-text");
      item.createSpan({ cls: "ai-link-suggest-item-name", text: f.basename });
      const parent = f.parent?.path ?? "";
      item.createSpan({ cls: "ai-link-suggest-item-path", text: parent });
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.selected = i;
        this.pick();
      });
    }
    // 定位到输入框上方；空间不够则放下方
    const rect = this.input.getBoundingClientRect();
    this.el.style.left = rect.left + "px";
    this.el.style.width = Math.min(340, rect.width) + "px";
    const spaceAbove = rect.top - 8;
    const h = this.el.offsetHeight;
    this.el.style.top =
      spaceAbove > h + 8 ? rect.top - h - 4 + "px" : rect.bottom + 4 + "px";
  }

  private onKeydown(e: KeyboardEvent): void {
    if (!this.el) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.selected = (this.selected + 1) % this.items.length;
      this.highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.selected = (this.selected - 1 + this.items.length) % this.items.length;
      this.highlight();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.pick();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    }
  }

  private highlight(): void {
    if (!this.el) return;
    for (let i = 0; i < this.el.children.length; i++) {
      this.el.children[i].toggleClass("is-selected", i === this.selected);
    }
  }

  private pick(): void {
    const file = this.items[this.selected];
    const m = this.match;
    this.close();
    if (file && m) this.onPick(file, m);
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.match = null;
    this.items = [];
  }
}

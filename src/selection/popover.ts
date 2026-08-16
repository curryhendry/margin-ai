import { Editor, Notice } from "obsidian";
import type AIPlugin from "../main";
import { ChatMessage, UsageInfo } from "../llm/types";
import { getProvider } from "../llm";
import { modelLimitsText } from "../settings";

/** 置顶层级：保证悬浮窗盖在 Obsidian 其它元素之上 */
const Z_TOP = 2147483000;

/**
 * 划词悬浮对话。交互参照 Copilot：
 * 选中文字 → 右键唯一菜单「Margin」→ 弹出悬浮框，
 * 基于选区提问，结果可插入光标 / 覆盖选区。
 * - 每条消息自带复制图标（hover 显示）
 * - 可拖动头部
 * - 点击页面其它位置不会关闭，只能点 ✕
 * - 始终置顶
 */
export class SelectionPopover {
  private plugin: AIPlugin;
  private editor: Editor;
  private selected: string;
  private messages: ChatMessage[] = [];
  private from: { line: number; ch: number };
  private to: { line: number; ch: number };
  private root?: HTMLElement;
  private messagesEl?: HTMLElement;
  private inputEl?: HTMLTextAreaElement;
  private actionsEl?: HTMLElement;
  private usageEl?: HTMLElement;
  private lastResult = "";
  private busy = false;

  constructor(plugin: AIPlugin, editor: Editor, selected: string) {
    this.plugin = plugin;
    this.editor = editor;
    this.selected = selected;
    this.from = editor.getCursor("from");
    this.to = editor.getCursor("to");
  }

  open(): void {
    const root = document.createElement("div");
    root.className = "ai-popover";
    root.style.zIndex = String(Z_TOP);
    root.addEventListener("click", (e) => e.stopPropagation());

    // 头部（可拖动）
    const header = root.createDiv({ cls: "ai-popover-header" });
    const title = header.createSpan({ cls: "ai-popover-title", text: "Margin" });
    title.addClass("ai-popover-drag");
    const close = header.createEl("button", {
      cls: "ai-popover-close",
      text: "✕",
      attr: { type: "button", title: "关闭" },
    });
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });

    // 选区预览
    const ctx = root.createDiv({ cls: "ai-popover-ctx" });
    ctx.createSpan({ cls: "ai-popover-ctx-label", text: "选区" });
    ctx.createSpan({
      cls: "ai-popover-ctx-text",
      text:
        this.selected.slice(0, 120) + (this.selected.length > 120 ? "…" : ""),
    });

    // 消息 / 用量 / 操作区
    this.messagesEl = root.createDiv({ cls: "ai-popover-messages" });
    this.usageEl = root.createDiv({ cls: "ai-popover-usage" });
    this.actionsEl = root.createDiv({ cls: "ai-popover-actions" });
    this.renderActions();

    // 输入区
    const inputWrap = root.createDiv({ cls: "ai-popover-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "ai-popover-input",
      placeholder: "基于选区提问，Enter 发送，Shift+Enter 换行",
    });
    // 不用 mod-cta，避免大紫按钮
    const send = inputWrap.createEl("button", {
      cls: "ai-popover-send",
      text: "发送",
    });
    send.addEventListener("click", () => this.send());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    document.body.appendChild(root);
    this.root = root;
    this.inputEl.focus();

    const rect = this.getSelectionRect();
    this.position(rect);
    this.makeDraggable(header);
  }

  private getSelectionRect(): DOMRect | null {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r && (r.width > 0 || r.height > 0)) return r;
    }
    return null;
  }

  private position(rect: DOMRect | null): void {
    if (!this.root) return;
    const w = 380;
    const h = 420;
    let x = rect ? rect.left : window.innerWidth / 2 - w / 2;
    let y = rect ? rect.bottom + 8 : window.innerHeight / 2 - h / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    this.root.style.width = w + "px";
    this.root.style.left = x + "px";
    this.root.style.top = y + "px";
  }

  private makeDraggable(header: HTMLElement): void {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;

    header.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest(".ai-popover-close")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = this.root?.offsetLeft ?? 0;
      origY = this.root?.offsetTop ?? 0;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging || !this.root) return;
      let x = origX + (e.clientX - startX);
      let y = origY + (e.clientY - startY);
      x = Math.max(0, Math.min(x, window.innerWidth - this.root.offsetWidth));
      y = Math.max(0, Math.min(y, window.innerHeight - this.root.offsetHeight));
      this.root.style.left = x + "px";
      this.root.style.top = y + "px";
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  close(): void {
    this.root?.remove();
    this.root = undefined;
  }

  /** 仅保留「插入光标 / 覆盖选区」两个真操作；复制由每条消息自带图标完成。 */
  private renderActions(): void {
    if (!this.actionsEl) return;
    this.actionsEl.empty();
    if (!this.lastResult) {
      this.actionsEl.setText("");
      return;
    }
    const mk = (label: string, icon: string, fn: () => void): void => {
      const b = this.actionsEl!.createEl("button", {
        cls: "ai-popover-btn",
        text: `${icon} ${label}`,
      });
      b.addEventListener("click", fn);
    };

    mk("插入光标", "📥", () => {
      this.editor.replaceRange(this.lastResult, this.editor.getCursor());
      new Notice("已插入到光标处");
    });

    mk("覆盖选区", "🔁", () => {
      this.editor.replaceRange(this.lastResult, this.from, this.to);
      new Notice("已覆盖选区");
    });
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    this.messagesEl.empty();
    for (const m of this.messages) {
      const text = this.displayText(m);
      const bubble = this.messagesEl.createDiv({
        cls: `ai-popover-msg ai-popover-msg-${m.role}`,
      });
      bubble.createDiv({
        cls: "ai-popover-msg-role",
        text: m.role === "user" ? "你" : "AI",
      });
      bubble.createDiv({ cls: "ai-popover-msg-content", text });

      // 复制图标
      const copyBtn = bubble.createEl("button", {
        cls: "ai-popover-msg-copy",
        text: "📋",
        attr: { type: "button", title: "复制本条消息" },
      });
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        new Notice("已复制");
      });
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private displayText(m: ChatMessage): string {
    const marker = "请基于上述文本回答我的问题：";
    const i = m.content.indexOf(marker);
    if (m.role === "user" && i >= 0) {
      return "📌 基于选区：" + m.content.slice(i + marker.length);
    }
    return m.content;
  }

  private async send(): Promise<void> {
    const text = this.inputEl?.value.trim();
    if (!text || this.busy) return;
    const model =
      this.plugin.settings.models.find(
        (m) => m.id === this.plugin.settings.defaultModelId
      ) || this.plugin.settings.models[0];
    if (!model) {
      new Notice("请先在设置中添加 Gemini 模型");
      return;
    }

    if (this.messages.length === 0) {
      this.messages.push({
        role: "user",
        content: `以下是选中的文本：\n"""\n${this.selected}\n"""\n\n请基于上述文本回答我的问题：${text}`,
      });
    } else {
      this.messages.push({ role: "user", content: text });
    }

    if (this.inputEl) this.inputEl.value = "";
    this.busy = true;

    this.renderMessages();

    let acc = "";
    const aiBubble = this.messagesEl!.createDiv({
      cls: "ai-popover-msg ai-popover-msg-model",
    });
    aiBubble.createDiv({ cls: "ai-popover-msg-role", text: "AI" });
    const contentEl = aiBubble.createDiv({
      cls: "ai-popover-msg-content",
      text: "",
    });
    const copyBtn = aiBubble.createEl("button", {
      cls: "ai-popover-msg-copy",
      text: "📋",
      attr: { type: "button", title: "复制本条消息" },
    });
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(acc);
      new Notice("已复制");
    });

    const provider = getProvider(model.provider);
    try {
      await provider.chat(
        model,
        this.messages,
        {
          onToken: (t) => {
            acc += t;
            contentEl.setText(acc);
            this.messagesEl!.scrollTop = this.messagesEl!.scrollHeight;
          },
          onDone: (u: UsageInfo | null) => {
            this.messages.push({ role: "model", content: acc });
            this.lastResult = acc;
            this.renderActions();
            this.renderUsage(u);
          },
          onError: (e) => {
            new Notice("错误：" + e.message);
            contentEl.setText("⚠️ " + e.message);
          },
        },
        { systemInstruction: this.plugin.settings.systemInstruction }
      );
    } finally {
      this.busy = false;
    }
  }

  /** 模型限额 + 本次用量 */
  private renderUsage(u: UsageInfo | null): void {
    if (!this.usageEl) return;
    this.usageEl.empty();
    const model =
      this.plugin.settings.models.find(
        (m) => m.id === this.plugin.settings.defaultModelId
      ) || this.plugin.settings.models[0];
    if (!model) {
      this.usageEl.setText("未选模型");
      return;
    }
    const limits = modelLimitsText(model);
    const line1 = this.usageEl.createDiv({ cls: "ai-popover-usage-line" });
    line1.setText(`${model.name}${limits ? " · " + limits : ""}`);
    if (u) {
      const line2 = this.usageEl.createDiv({
        cls: "ai-popover-usage-line",
      });
      line2.setText(
        `本次 提示 ${u.promptTokens} · 补全 ${u.completionTokens} · 总计 ${u.totalTokens}`
      );
    }
  }
}
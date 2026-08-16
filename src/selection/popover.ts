import { Editor, Notice } from "obsidian";
import type AIPlugin from "../main";
import { ChatMessage, UsageInfo } from "../llm/types";
import { getProvider } from "../llm";
import { modelLimitsText } from "../settings";
import { copyText } from "../util";

/** 置顶层级 */
const Z_TOP = 2147483000;

interface SavedConv {
  messages: ChatMessage[];
  lastResult: string;
}

/**
 * 划词 / `/p` 悬浮对话。交互参照 Copilot：
 * - 基于选区提问；结果可插入光标 / 覆盖选区
 * - 每条消息自带复制图标，用户消息可编辑重发
 * - 对话按笔记记忆：同一笔记再次打开悬浮窗，继续上次的对话
 * - 可拖动头部；点外部不关闭（防丢失）；始终置顶
 */
export class SelectionPopover {
  /** 按笔记路径保存对话，跨悬浮窗实例恢复 */
  private static savedByNote = new Map<string, SavedConv>();

  private plugin: AIPlugin;
  private editor: Editor;
  private selected: string;
  private messages: ChatMessage[] = [];
  private from: { line: number; ch: number };
  private to: { line: number; ch: number };
  private noteKey = "";
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
    this.noteKey = this.plugin.app.workspace.getActiveFile()?.path ?? "";

    // 恢复该笔记上次的对话（若有）
    const saved = SelectionPopover.savedByNote.get(this.noteKey);
    if (saved) {
      this.messages = [...saved.messages];
      this.lastResult = saved.lastResult;
    }

    const root = document.createElement("div");
    root.className = "ai-popover";
    root.style.zIndex = String(Z_TOP);
    root.addEventListener("click", (e) => e.stopPropagation());

    // 头部：标题 + 重来 + 关闭（可拖动）
    const header = root.createDiv({ cls: "ai-popover-header" });
    const title = header.createSpan({ cls: "ai-popover-title", text: "Margin" });
    title.addClass("ai-popover-drag");
    const right = header.createDiv({ cls: "ai-popover-header-right" });
    const resetBtn = right.createEl("button", {
      cls: "ai-popover-reset",
      text: "↺",
      attr: { type: "button", title: "重来（清空本笔记对话）" },
    });
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.reset();
    });
    const close = right.createEl("button", {
      cls: "ai-popover-close",
      text: "✕",
      attr: { type: "button", title: "关闭" },
    });
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });

    // 选区预览（仅当有选区）
    if (this.selected) {
      const ctx = root.createDiv({ cls: "ai-popover-ctx" });
      ctx.createSpan({ cls: "ai-popover-ctx-label", text: "选区" });
      ctx.createSpan({
        cls: "ai-popover-ctx-text",
        text:
          this.selected.slice(0, 120) +
          (this.selected.length > 120 ? "…" : ""),
      });
    }

    // 消息 / 用量 / 操作区
    this.messagesEl = root.createDiv({ cls: "ai-popover-messages" });
    this.usageEl = root.createDiv({ cls: "ai-popover-usage" });
    this.actionsEl = root.createDiv({ cls: "ai-popover-actions" });

    // 输入区
    const inputWrap = root.createDiv({ cls: "ai-popover-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "ai-popover-input",
      placeholder: this.selected
        ? "基于选区提问，Enter 发送，Shift+Enter 换行"
        : "输入问题，Enter 发送，Shift+Enter 换行",
    });
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

    this.renderMessages();
    this.renderActions();
    this.renderUsage(null);
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
    const w = Math.min(360, window.innerWidth - 16);
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

    const isBtn = (t: EventTarget | null): boolean =>
      !!(t as HTMLElement)?.closest?.(".ai-popover-close, .ai-popover-reset");

    const begin = (cx: number, cy: number): void => {
      dragging = true;
      startX = cx;
      startY = cy;
      origX = this.root?.offsetLeft ?? 0;
      origY = this.root?.offsetTop ?? 0;
    };
    const move = (cx: number, cy: number): void => {
      if (!dragging || !this.root) return;
      let x = origX + (cx - startX);
      let y = origY + (cy - startY);
      x = Math.max(0, Math.min(x, window.innerWidth - this.root.offsetWidth));
      y = Math.max(0, Math.min(y, window.innerHeight - this.root.offsetHeight));
      this.root.style.left = x + "px";
      this.root.style.top = y + "px";
    };
    const end = (): void => {
      dragging = false;
    };

    // 桌面端：鼠标拖动
    header.addEventListener("mousedown", (e) => {
      if (isBtn(e.target)) return;
      begin(e.clientX, e.clientY);
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
    document.addEventListener("mouseup", end);

    // 移动端：触摸拖动
    header.addEventListener("touchstart", (e) => {
      if (isBtn(e.target) || !e.touches[0]) return;
      begin(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    });
    document.addEventListener(
      "touchmove",
      (e) => {
        if (dragging && e.touches[0]) {
          move(e.touches[0].clientX, e.touches[0].clientY);
          e.preventDefault();
        }
      },
      { passive: false }
    );
    document.addEventListener("touchend", end);
  }

  /** 关闭时把对话存回笔记维度 */
  close(): void {
    if (this.noteKey && this.messages.length > 0) {
      SelectionPopover.savedByNote.set(this.noteKey, {
        messages: [...this.messages],
        lastResult: this.lastResult,
      });
    }
    this.root?.remove();
    this.root = undefined;
  }

  /** 重来：清空本笔记对话与已存记录 */
  private reset(): void {
    this.messages = [];
    this.lastResult = "";
    SelectionPopover.savedByNote.delete(this.noteKey);
    this.renderMessages();
    this.renderActions();
    this.renderUsage(null);
    this.inputEl?.focus();
  }

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

      // 复制图标（每条消息）
      const copyBtn = bubble.createEl("button", {
        cls: "ai-popover-msg-copy",
        text: "📋",
        attr: { type: "button", title: "复制本条消息" },
      });
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyText(text);
      });

      // 用户消息可编辑重发
      if (m.role === "user") {
        const editBtn = bubble.createEl("button", {
          cls: "ai-popover-msg-edit",
          text: "✏️",
          attr: { type: "button", title: "编辑并重发" },
        });
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.editMessage(m);
        });
      }
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** 首条带选区上下文的消息，展示时只显示问题本身 */
  private displayText(m: ChatMessage): string {
    const marker = "请基于上述文本回答我的问题：";
    const i = m.content.indexOf(marker);
    if (m.role === "user" && i >= 0) {
      return "📌 基于选区：" + m.content.slice(i + marker.length);
    }
    return m.content;
  }

  /** 编辑用户消息：截断到该条之前，把内容回填输入框重发 */
  private editMessage(m: ChatMessage): void {
    const idx = this.messages.indexOf(m);
    if (idx < 0 || !this.inputEl) return;
    this.messages = this.messages.slice(0, idx);
    let t = this.displayText(m).replace(/^📌 基于选区：/, "");
    this.inputEl.value = t;
    this.renderMessages();
    this.renderActions();
    this.inputEl.focus();
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
      if (this.selected) {
        // 首轮：把选区作为上下文带给模型（多轮后模型仍记得选的是什么）
        this.messages.push({
          role: "user",
          content: `以下是选中的文本：\n"""\n${this.selected}\n"""\n\n请基于上述文本回答我的问题：${text}`,
        });
      } else {
        this.messages.push({ role: "user", content: text });
      }
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
      copyText(acc);
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
      const line2 = this.usageEl.createDiv({ cls: "ai-popover-usage-line" });
      line2.setText(
        `本次 提示 ${u.promptTokens} · 补全 ${u.completionTokens} · 总计 ${u.totalTokens}`
      );
    }
  }
}
import { Editor, Notice } from "obsidian";
import type AIPlugin from "../main";
import { ChatMessage, UsageInfo } from "../llm/types";
import { getProvider } from "../llm";

/**
 * 划词悬浮对话。参照 Copilot 的交互：选中文字 → 右键一个菜单项 → 弹出悬浮框，
 * 基于选区提问，结果可复制 / 插入光标 / 覆盖选区 / 继续对话。保持简单，不堆功能。
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
    // 记录选区范围，供“覆盖”使用
    this.from = editor.getCursor("from");
    this.to = editor.getCursor("to");
  }

  open(): void {
    const root = document.createElement("div");
    root.className = "ai-popover";
    root.addEventListener("click", (e) => e.stopPropagation());

    // 定位到选区附近
    const sel = window.getSelection();
    let top = 120;
    let left = 120;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      top = r.bottom + 6;
      left = r.left;
    }
    top = Math.min(top, window.innerHeight - 340);
    left = Math.max(8, Math.min(left, window.innerWidth - 372));
    root.style.top = `${top}px`;
    root.style.left = `${left}px`;

    // 头部
    const header = root.createDiv({ cls: "ai-popover-header" });
    header.createSpan({ cls: "ai-popover-title", text: "AI 对话" });
    const close = header.createSpan({ cls: "ai-popover-close", text: "×" });
    close.addEventListener("click", () => this.close());

    // 选区预览
    const ctx = root.createDiv({ cls: "ai-popover-ctx" });
    ctx.createSpan({ text: "选区：" });
    ctx.createSpan({
      cls: "ai-popover-ctx-text",
      text:
        this.selected.slice(0, 120) + (this.selected.length > 120 ? "…" : ""),
    });

    // 消息区
    this.messagesEl = root.createDiv({ cls: "ai-popover-messages" });
    this.usageEl = root.createDiv({ cls: "ai-popover-usage" });

    // 操作按钮区（结果出来后才有内容）
    this.actionsEl = root.createDiv({ cls: "ai-popover-actions" });
    this.renderActions();

    // 输入区
    const inputWrap = root.createDiv({ cls: "ai-popover-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "ai-popover-input",
      placeholder: "输入指令，例如：解释这段 / 改写成口语 / 翻译为英文",
    });
    const send = inputWrap.createEl("button", {
      cls: "ai-popover-send mod-cta",
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

    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener("click", this.onOutside, true);
    }, 0);
  }

  private onOutside = (e: MouseEvent): void => {
    if (this.root && !this.root.contains(e.target as Node)) {
      this.close();
    }
  };

  close(): void {
    document.removeEventListener("click", this.onOutside, true);
    this.root?.remove();
    this.root = undefined;
  }

  private renderActions(): void {
    if (!this.actionsEl) return;
    this.actionsEl.empty();
    if (!this.lastResult) {
      this.actionsEl.setText("");
      return;
    }
    const copy = this.actionsEl.createEl("button", {
      cls: "ai-popover-btn",
      text: "复制",
    });
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(this.lastResult);
      new Notice("已复制到剪贴板");
    });

    const insert = this.actionsEl.createEl("button", {
      cls: "ai-popover-btn",
      text: "插入光标处",
    });
    insert.addEventListener("click", () => {
      this.editor.replaceRange(this.lastResult, this.editor.getCursor());
      new Notice("已插入到光标处");
    });

    const cover = this.actionsEl.createEl("button", {
      cls: "ai-popover-btn mod-warning",
      text: "覆盖选区",
    });
    cover.addEventListener("click", () => {
      this.editor.replaceRange(this.lastResult, this.from, this.to);
      new Notice("已覆盖选区");
    });

    const cont = this.actionsEl.createEl("button", {
      cls: "ai-popover-btn",
      text: "继续对话",
    });
    cont.addEventListener("click", () => this.inputEl?.focus());
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
      // 第一轮：把选区作为上下文带给模型
      this.messages.push({
        role: "user",
        content: `以下是选中的文本：\n"""\n${this.selected}\n"""\n\n请基于上述文本回答我的问题：${text}`,
      });
    } else {
      this.messages.push({ role: "user", content: text });
    }

    if (this.inputEl) this.inputEl.value = "";
    this.busy = true;

    const aiBubble = this.messagesEl!.createDiv({
      cls: "ai-popover-msg ai-popover-msg-model",
    });
    const contentEl = aiBubble.createEl("div", {
      cls: "ai-popover-msg-content",
      text: "",
    });
    let acc = "";

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
    if (!u || !this.usageEl) return;
    this.usageEl.setText(
      `用量: 提示 ${u.promptTokens} · 补全 ${u.completionTokens} · 总计 ${u.totalTokens}`
    );
  }
}

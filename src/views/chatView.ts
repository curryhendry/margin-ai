import { EventRef, ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type AIPlugin from "../main";
import { ChatMessage, UsageInfo } from "../llm/types";
import { getProvider } from "../llm";
import { modelLimitsText } from "../settings";

export const VIEW_TYPE_CHAT = "margin-chat";

interface SessionUsage {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * 右侧 Chat。对话按笔记隔离：
 * 切换笔记时自动保存当前上下文、加载新笔记的上下文。
 */
export class ChatView extends ItemView {
  plugin: AIPlugin;
  messages: ChatMessage[] = [];
  private histories = new Map<string, ChatMessage[]>();
  private usageByNote = new Map<string, SessionUsage>();
  private noteKey = "";
  private fileOpenRef: EventRef | null = null;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private modelSelect!: HTMLSelectElement;
  private usageEl!: HTMLElement;
  private busy = false;
  private sessionUsage: SessionUsage = { prompt: 0, completion: 0, total: 0 };

  constructor(leaf: WorkspaceLeaf, plugin: AIPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }
  getDisplayText(): string {
    return "Margin";
  }
  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.noteKey = this.currentNote();
    this.loadNote();
    this.fileOpenRef = this.app.workspace.on("file-open", () =>
      this.switchNote()
    );
  }
  async onClose(): Promise<void> {
    if (this.fileOpenRef) this.app.workspace.offref(this.fileOpenRef);
    this.saveNote();
  }

  private currentNote(): string {
    return this.app.workspace.getActiveFile()?.path ?? "(无笔记)";
  }

  private saveNote(): void {
    if (!this.noteKey) return;
    this.histories.set(this.noteKey, this.messages);
    this.usageByNote.set(this.noteKey, { ...this.sessionUsage });
  }

  private loadNote(): void {
    this.messages = this.histories.get(this.noteKey) ?? [];
    this.sessionUsage =
      this.usageByNote.get(this.noteKey) ?? { prompt: 0, completion: 0, total: 0 };
    this.renderMessages();
    this.showUsage(null);
  }

  private switchNote(): void {
    this.saveNote();
    this.noteKey = this.currentNote();
    this.loadNote();
  }

  /** 设置变更后刷新模型下拉 */
  refreshModels(): void {
    if (!this.modelSelect) return;
    this.populateModels();
    this.showUsage(null);
  }

  private currentModel() {
    const id = this.modelSelect?.value;
    return (
      this.plugin.settings.models.find((m) => m.id === id) ||
      this.plugin.settings.models[0]
    );
  }

  private populateModels(): void {
    this.modelSelect.empty();
    for (const m of this.plugin.settings.models) {
      this.modelSelect.createEl("option", { text: m.name, value: m.id });
    }
    if (this.plugin.settings.defaultModelId) {
      this.modelSelect.value = this.plugin.settings.defaultModelId;
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("ai-chat");

    const header = root.createDiv({ cls: "ai-chat-header" });
    this.modelSelect = header.createEl("select", {
      cls: "ai-chat-model-select dropdown",
    });
    this.populateModels();
    this.modelSelect.addEventListener("change", () => this.showUsage(null));

    // 当前笔记标识
    const note = header.createEl("span", { cls: "ai-chat-note" });
    note.setText(this.noteKey ? "📄 " + this.noteKey : "");

    const newBtn = header.createEl("button", {
      cls: "ai-chat-clear",
      text: "新对话",
    });
    newBtn.addEventListener("click", () => {
      this.histories.delete(this.noteKey);
      this.usageByNote.delete(this.noteKey);
      this.messages = [];
      this.sessionUsage = { prompt: 0, completion: 0, total: 0 };
      this.renderMessages();
      this.showUsage(null);
    });

    this.messagesEl = root.createDiv({ cls: "ai-chat-messages" });

    this.usageEl = root.createDiv({ cls: "ai-chat-usage" });
    this.showUsage(null);

    const inputWrap = root.createDiv({ cls: "ai-chat-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "ai-chat-input",
      placeholder: "输入消息，Enter 发送，Shift+Enter 换行",
    });
    const sendBtn = inputWrap.createEl("button", {
      cls: "ai-chat-send",
      text: "发送",
    });
    sendBtn.addEventListener("click", () => this.send());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    this.renderMessages();
  }

  private renderMessages(): void {
    this.messagesEl.empty();
    for (const m of this.messages) {
      const bubble = this.messagesEl.createDiv({
        cls: `ai-msg ai-msg-${m.role}`,
      });
      bubble.createEl("div", {
        cls: "ai-msg-role",
        text: m.role === "user" ? "你" : "AI",
      });
      bubble.createEl("div", { cls: "ai-msg-content", text: m.content });

      // 复制（每条消息）
      const copyBtn = bubble.createEl("button", {
        cls: "ai-msg-copy",
        text: "📋",
        attr: { type: "button", title: "复制本条消息" },
      });
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(m.content);
        new Notice("已复制");
      });

      // 用户消息可编辑重发
      if (m.role === "user") {
        const editBtn = bubble.createEl("button", {
          cls: "ai-msg-edit",
          text: "✏️",
          attr: { type: "button", title: "编辑并重发" },
        });
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = this.messages.indexOf(m);
          this.messages = this.messages.slice(0, idx);
          this.inputEl.value = m.content;
          this.renderMessages();
          this.inputEl.focus();
        });
      }
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    const model = this.currentModel();
    if (!model) {
      new Notice("请先在设置中添加 Gemini 模型");
      return;
    }
    this.inputEl.value = "";
    this.messages.push({ role: "user", content: text });
    this.renderMessages();
    this.busy = true;

    let acc = "";
    const aiBubble = this.messagesEl.createDiv({ cls: "ai-msg ai-msg-model" });
    aiBubble.createEl("div", { cls: "ai-msg-role", text: "AI" });
    const contentEl = aiBubble.createEl("div", {
      cls: "ai-msg-content",
      text: "",
    });
    const copyBtn = aiBubble.createEl("button", {
      cls: "ai-msg-copy",
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
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
          },
          onDone: (usage) => {
            this.messages.push({ role: "model", content: acc });
            if (usage) {
              this.sessionUsage.prompt += usage.promptTokens;
              this.sessionUsage.completion += usage.completionTokens;
              this.sessionUsage.total += usage.totalTokens;
            }
            this.showUsage(usage);
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

  /** 用量 / 模型限额。两行：上行模型+限额，下行会话+本次用量 */
  private showUsage(u: UsageInfo | null): void {
    this.usageEl.empty();
    const m = this.currentModel();
    const limits = m ? modelLimitsText(m) : "";
    const row1 = this.usageEl.createDiv({ cls: "ai-chat-usage-line" });
    row1.setText(`${m?.name ?? "未选模型"}${limits ? " · " + limits : ""}`);
    const row2 = this.usageEl.createDiv({ cls: "ai-chat-usage-line" });
    const s = this.sessionUsage;
    const tail = u
      ? `本次 ${u.promptTokens}+${u.completionTokens}=${u.totalTokens}`
      : "—";
    row2.setText(
      `会话累计 ${s.prompt}+${s.completion}=${s.total} tokens · ${tail}`
    );
  }
}
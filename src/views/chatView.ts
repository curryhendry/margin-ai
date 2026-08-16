import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type AIPlugin from "../main";
import { ChatMessage, UsageInfo } from "../llm/types";
import { getProvider } from "../llm";
import { fmtLimit, modelLimitsText } from "../settings";

export const VIEW_TYPE_CHAT = "margin-chat";

export class ChatView extends ItemView {
  plugin: AIPlugin;
  messages: ChatMessage[] = [];
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private modelSelect!: HTMLSelectElement;
  private usageEl!: HTMLElement;
  private busy = false;
  /** 会话累计用量 */
  private sessionUsage = { prompt: 0, completion: 0, total: 0 };

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
  }
  async onClose(): Promise<void> {
    // nothing
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
    const clearBtn = header.createEl("button", {
      cls: "ai-chat-clear",
      text: "清空",
    });
    clearBtn.addEventListener("click", () => {
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
    // 不带 mod-cta，避免默认大紫按钮
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

      // 复制图标：hover 显示，点击复制本条消息
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

  /** 用量 / 模型限额展示。两行：上行模型+限额，下行会话+本次用量 */
  private showUsage(u: UsageInfo | null): void {
    this.usageEl.empty();
    const m = this.currentModel();
    const limits = m ? modelLimitsText(m) : "";
    const row1 = this.usageEl.createDiv({ cls: "ai-chat-usage-line" });
    row1.setText(
      `${m?.name ?? "未选模型"}${limits ? " · " + limits : ""}`
    );
    const row2 = this.usageEl.createDiv({ cls: "ai-chat-usage-line" });
    const s = this.sessionUsage;
    const tail = u ? `本次 ${u.promptTokens}+${u.completionTokens}=${u.totalTokens}` : "—";
    row2.setText(
      `会话累计 ${s.prompt}+${s.completion}=${s.total} tokens · ${tail}`
    );
  }
}
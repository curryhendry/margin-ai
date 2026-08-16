import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type AIPlugin from "../main";
import { ChatMessage, UsageInfo } from "../llm/types";
import { getProvider } from "../llm";

export const VIEW_TYPE_CHAT = "margin-chat";

export class ChatView extends ItemView {
  plugin: AIPlugin;
  messages: ChatMessage[] = [];
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private modelSelect!: HTMLSelectElement;
  private usageEl!: HTMLElement;
  private busy = false;

  constructor(leaf: WorkspaceLeaf, plugin: AIPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }
  getDisplayText(): string {
    return "AI Chat";
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
    const clearBtn = header.createEl("button", {
      cls: "ai-chat-clear",
      text: "清空",
    });
    clearBtn.addEventListener("click", () => {
      this.messages = [];
      this.renderMessages();
    });

    this.messagesEl = root.createDiv({ cls: "ai-chat-messages" });

    this.usageEl = root.createDiv({ cls: "ai-chat-usage" });

    const inputWrap = root.createDiv({ cls: "ai-chat-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "ai-chat-input",
      placeholder: "输入消息，Enter 发送，Shift+Enter 换行",
    });
    const sendBtn = inputWrap.createEl("button", {
      cls: "ai-chat-send mod-cta",
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

    const aiBubble = this.messagesEl.createDiv({ cls: "ai-msg ai-msg-model" });
    aiBubble.createEl("div", { cls: "ai-msg-role", text: "AI" });
    const contentEl = aiBubble.createEl("div", {
      cls: "ai-msg-content",
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
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
          },
          onDone: (usage) => {
            this.messages.push({ role: "model", content: acc });
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

  private showUsage(u: UsageInfo | null): void {
    if (!u) {
      this.usageEl.setText("");
      return;
    }
    this.usageEl.setText(
      `本次用量 — 提示 ${u.promptTokens} · 补全 ${u.completionTokens} · 总计 ${u.totalTokens} tokens`
    );
  }
}

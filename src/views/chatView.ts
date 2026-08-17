import { EventRef, ItemView, WorkspaceLeaf, Notice, TFile, setIcon } from "obsidian";
import type AIPlugin from "../main";
import { ChatMessage, UsageInfo } from "../llm/types";
import { getProvider } from "../llm";
import { modelLimitsText, type AIModel } from "../settings";
import { copyText } from "../util";
import { NoteLinkSuggest } from "../linkSuggest";
import { t, tf } from "../i18n";

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
  private attachEl!: HTMLElement;
  private attachedNotes: { path: string; basename: string }[] = [];
  private linkSuggest?: NoteLinkSuggest;
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
    // 打开 Chat 时自动关联当前笔记（显示为输入框内可删标签）
    this.autoAttachCurrentNote();
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

  /** 渲染输入框内的关联笔记 chip（可删除） */
  private renderAttachedChips(): void {
    if (!this.attachEl) return;
    this.attachEl.empty();
    if (this.attachedNotes.length === 0) return;
    for (const n of this.attachedNotes) {
      const chip = this.attachEl.createSpan({ cls: "ai-chat-attach-chip" });
      chip.createSpan({ text: "[[" + n.basename + "]]" });
      const rm = chip.createEl("button", {
        cls: "ai-chat-attach-remove",
        text: "×",
        attr: { type: "button", title: t("common.remove_attach") },
      });
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        this.attachedNotes = this.attachedNotes.filter(
          (x) => x.path !== n.path
        );
        this.renderAttachedChips();
      });
    }
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

    const newBtn = header.createEl("button", {
      cls: "ai-chat-clear",
      attr: { type: "button", title: t("chat.new") },
    });
    setIcon(newBtn, "plus");
    newBtn.addEventListener("click", () => {
      this.histories.delete(this.noteKey);
      this.usageByNote.delete(this.noteKey);
      this.messages = [];
      this.sessionUsage = { prompt: 0, completion: 0, total: 0 };
      this.attachedNotes = [];
      this.renderAttachedChips();
      this.renderMessages();
      this.showUsage(null);
    });

    this.messagesEl = root.createDiv({ cls: "ai-chat-messages" });

    this.usageEl = root.createDiv({ cls: "ai-chat-usage" });
    this.showUsage(null);

    // 输入框上方的关联笔记 chip 区（可删除）
    this.attachEl = root.createDiv({ cls: "ai-chat-attach" });
    this.renderAttachedChips();

    const inputWrap = root.createDiv({ cls: "ai-chat-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "ai-chat-input",
      placeholder: t("chat.placeholder"),
    });
    const sendBtn = inputWrap.createEl("button", {
      cls: "ai-chat-send",
      text: t("common.send"),
    });
    sendBtn.addEventListener("click", () => this.send());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    // [[ 笔记补全：选中即插入 [[笔记]] 并立即显示为关联标签
    this.linkSuggest = new NoteLinkSuggest(this.app, this.inputEl, (file, m) =>
      this.insertNoteRef(file, m)
    );

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
        text: m.role === "user" ? t("common.you") : "AI",
      });
      bubble.createEl("div", { cls: "ai-msg-content", text: m.content });

      // 复制（每条消息）
      const copyBtn = bubble.createEl("button", {
        cls: "ai-msg-copy",
        attr: { type: "button", title: t("common.copy") },
      });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyText(m.content);
      });

      // 用户消息可编辑重发
      if (m.role === "user") {
        const editBtn = bubble.createEl("button", {
          cls: "ai-msg-edit",
          text: "✏️",
          attr: { type: "button", title: t("common.edit_resend") },
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
      new Notice(t("common.no_model"));
      return;
    }
    // 解析 [[笔记名]] → 加入输入框关联 chip（可删除）
    this.attachRefsFromText(text);
    this.inputEl.value = "";
    this.messages.push({ role: "user", content: text });
    this.renderMessages();

    await this.runAssistantTurn(model);
  }

  /** 从消息文本解析 [[笔记名]]：resolve 成功后加入关联列表，失败给出提示 */
  private attachRefsFromText(text: string): void {
    const re = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    let added = false;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      if (!name) continue;
      const f = this.resolveNote(name);
      if (!f) {
        new Notice(tf("chat.note_not_found", { name }));
        continue;
      }
      if (!this.attachedNotes.some((x) => x.path === f.path)) {
        this.attachedNotes.push({ path: f.path, basename: f.basename });
        added = true;
      }
    }
    if (added) this.renderAttachedChips();
  }

  /** [[X]] 补全选中：把 [[X]] 插入输入框并立即显示关联标签 */
  private insertNoteRef(file: TFile, match: { start: number; end: number }): void {
    const cur = this.inputEl.value;
    const insert = `[[${file.basename}]]`;
    this.inputEl.value = cur.slice(0, match.start) + insert + cur.slice(match.end);
    const pos = match.start + insert.length;
    this.inputEl.setSelectionRange(pos, pos);
    this.inputEl.focus();
    this.attachNote(file);
  }

  /** 把笔记加入关联列表并渲染标签（去重） */
  private attachNote(file: TFile): void {
    if (!this.attachedNotes.some((x) => x.path === file.path)) {
      this.attachedNotes.push({ path: file.path, basename: file.basename });
      this.renderAttachedChips();
    }
  }

  /** 打开 Chat 时把当前笔记自动加入关联标签（可见、可删） */
  private autoAttachCurrentNote(): void {
    if (!this.noteKey || this.noteKey === "(无笔记)") return;
    const f = this.app.vault.getAbstractFileByPath(this.noteKey);
    if (f instanceof TFile) this.attachNote(f);
  }

  /** 解析 [[名称]]：wikilink/路径优先，其次按 basename 精确/模糊匹配（兜底） */
  private resolveNote(name: string): TFile | null {
    const direct =
      this.app.metadataCache.getFirstLinkpathDest(name, "") ||
      this.app.vault.getAbstractFileByPath(name);
    if (direct instanceof TFile) return direct;
    const lower = name.toLowerCase();
    const files = this.app.vault.getMarkdownFiles();
    return (
      files.find((f) => f.basename.toLowerCase() === lower) ||
      files.find((f) => f.basename.toLowerCase().includes(lower)) ||
      null
    );
  }

  /**
   * 流式生成 AI 回复。send 与「重新获取」共用。
   * 把输入框内已关联（可删除）的笔记内容作为上下文（system instruction）发给 AI。
   * 失败时在气泡上加「↻ 重新获取」按钮，点击重跑这一轮（不清空历史）。
   * 对所有供应商生效。
   */
  private async runAssistantTurn(model: AIModel): Promise<void> {
    this.busy = true;
    console.log(
      "[Margin:chat] runAssistantTurn model=" +
        model.name +
        " noteKey=" +
        this.noteKey +
        " messages=" +
        this.messages.length
    );

    let acc = "";
    const aiBubble = this.messagesEl.createDiv({ cls: "ai-msg ai-msg-model" });
    const roleEl = aiBubble.createEl("div", { cls: "ai-msg-role" });
    roleEl.createSpan({ cls: "ai-loading-spinner" });
    const contentEl = aiBubble.createEl("div", {
      cls: "ai-msg-content",
      text: "",
    });
    const copyBtn = aiBubble.createEl("button", {
      cls: "ai-msg-copy",
      attr: { type: "button", title: t("common.copy") },
    });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(acc);
    });

    const provider = getProvider(model.provider);
    try {
      // 关联笔记：读取输入框内已关联（可删除）的笔记作为上下文
      const sys = this.plugin.settings.systemInstruction;
      let noteCtx = "";
      if (this.attachedNotes.length > 0) {
        const blocks: string[] = [];
        for (const n of this.attachedNotes) {
          const f = this.app.vault.getAbstractFileByPath(n.path);
          if (!(f instanceof TFile)) continue;
          try {
            const content = await this.app.vault.cachedRead(f);
            blocks.push(`[[${n.basename}]]\n\n${content}`);
          } catch (err) {
            console.warn("[Margin:chat] 读取关联笔记失败", n.path, err);
          }
        }
        if (blocks.length > 0) {
          noteCtx += `\n\n# ${t("chat.attached_notes")}\n${blocks.join("\n\n---\n\n")}`;
        }
      }
      const systemInstruction = (sys ? sys + "\n\n" : "") + noteCtx;

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
            roleEl.setText("AI");
            this.messages.push({ role: "model", content: acc });
            if (usage) {
              this.sessionUsage.prompt += usage.promptTokens;
              this.sessionUsage.completion += usage.completionTokens;
              this.sessionUsage.total += usage.totalTokens;
            }
            this.showUsage(usage);
          },
          onError: (e) => {
            console.error("[Margin:chat] chat error", e);
            roleEl.setText("AI");
            new Notice(t("common.error") + e.message);
            contentEl.setText("⚠️ " + e.message);
            const retryBtn = aiBubble.createEl("button", {
              cls: "ai-msg-retry",
              attr: { type: "button", title: t("common.retry") },
            });
            setIcon(retryBtn, "rotate-ccw");
            retryBtn.addEventListener("click", async (ev) => {
              ev.stopPropagation();
              aiBubble.remove();
              const m = this.currentModel();
              if (!m) return;
              await this.runAssistantTurn(m);
            });
          },
        },
        { systemInstruction }
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
    row1.setText(
      `${m?.name ?? t("common.no_model_selected")}${limits ? " · " + limits : ""}`
    );
    const row2 = this.usageEl.createDiv({ cls: "ai-chat-usage-line" });
    const s = this.sessionUsage;
    const tail = u
      ? tf("chat.this_usage", {
          prompt: u.promptTokens,
          completion: u.completionTokens,
          total: u.totalTokens,
        })
      : "—";
    row2.setText(
      tf("chat.session_usage", {
        prompt: s.prompt,
        completion: s.completion,
        total: s.total,
        tail,
      })
    );
  }
}
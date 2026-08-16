import { Editor, Notice, TFile, setIcon } from "obsidian";
import type AIPlugin from "../main";
import { ChatMessage, UsageInfo } from "../llm/types";
import { getProvider } from "../llm";
import { modelLimitsText, type AIModel } from "../settings";
import { copyText } from "../util";
import { NoteLinkSuggest } from "../linkSuggest";

/** 置顶层级 */
const Z_TOP = 2147483000;

/**
 * 划词 / `/p` 悬浮对话。交互参照 Copilot：
 * - 基于选区提问；结果可插入光标 / 覆盖选区
 * - 每条消息自带复制图标，用户消息可编辑重发
 * - 每次打开都是新对话（针对当前选区的一次性问答）
 * - 支持 [[笔记]] 关联标签（输入框内可删除）
 * - 可拖动头部；点外部不关闭（防丢失）；始终置顶
 */
export class SelectionPopover {

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
  private attachEl?: HTMLElement;
  private attachedNotes: { path: string; basename: string }[] = [];
  private linkSuggest?: NoteLinkSuggest;
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

    const root = document.createElement("div");
    root.className = "ai-popover";
    root.style.zIndex = String(Z_TOP);
    root.addEventListener("click", (e) => e.stopPropagation());

    // 头部：标题 + 重来 + 关闭（可拖动）
    const header = root.createDiv({ cls: "ai-popover-header" });
    const title = header.createSpan({ cls: "ai-popover-title", text: "Margin" });
    title.addClass("ai-popover-drag");
    const right = header.createDiv({ cls: "ai-popover-header-right" });
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

    // 输入区上方的关联笔记标签区（可删除）
    this.attachEl = root.createDiv({ cls: "ai-chat-attach" });
    this.renderAttachedChips();

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

    // [[ 笔记补全：选中即插入 [[笔记]] 并立即显示为关联标签
    this.linkSuggest = new NoteLinkSuggest(
      this.plugin.app,
      this.inputEl,
      (file, m) => this.insertNoteRef(file, m)
    );

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
    const w = Math.min(480, window.innerWidth - 16);
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
      !!(t as HTMLElement)?.closest?.(".ai-popover-close");

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

  /** 关闭悬浮窗（每次打开都是新对话，不保存） */
  close(): void {
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
    const mk = (label: string, iconId: string, fn: () => void): void => {
      const b = this.actionsEl!.createEl("button", {
        cls: "ai-popover-btn",
        attr: { type: "button", title: label },
      });
      setIcon(b, iconId);
      b.addEventListener("click", fn);
    };

    mk("插入光标", "corner-down-left", () => {
      this.editor.replaceRange(this.lastResult, this.editor.getCursor());
      new Notice("已插入到光标处");
    });

    mk("覆盖选区", "refresh-cw", () => {
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
        attr: { type: "button", title: "复制本条消息" },
      });
      setIcon(copyBtn, "copy");
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

  private currentModel() {
    return (
      this.plugin.settings.models.find(
        (m) => m.id === this.plugin.settings.defaultModelId
      ) || this.plugin.settings.models[0]
    );
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
        attr: { type: "button", title: "移除关联" },
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
        new Notice(`未找到笔记：${name}`);
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
    if (!this.inputEl) return;
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

  /** 解析 [[名称]]：wikilink/路径优先，其次按 basename 精确/模糊匹配（兜底） */
  private resolveNote(name: string): TFile | null {
    const direct =
      this.plugin.app.metadataCache.getFirstLinkpathDest(name, "") ||
      this.plugin.app.vault.getAbstractFileByPath(name);
    if (direct instanceof TFile) return direct;
    const lower = name.toLowerCase();
    const files = this.plugin.app.vault.getMarkdownFiles();
    return (
      files.find((f) => f.basename.toLowerCase() === lower) ||
      files.find((f) => f.basename.toLowerCase().includes(lower)) ||
      null
    );
  }

  private async send(): Promise<void> {
    const text = this.inputEl?.value.trim();
    if (!text || this.busy) return;
    const model = this.currentModel();
    if (!model) {
      new Notice("请先在设置中添加模型");
      return;
    }
    // 解析 [[笔记名]] → 加入输入框关联 chip（可删除）
    this.attachRefsFromText(text);

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
    this.renderMessages();

    await this.runAssistantTurn(model);
  }

  /**
   * 流式生成 AI 回复。send 与「重新获取」共用。
   * 失败时在气泡上加「↻ 重新获取」按钮，点击重跑这一轮（用户消息已在 messages 中，不重置历史）。
   * 对所有供应商生效（UI 层重发，与 provider 无关）。
   */
  private async runAssistantTurn(model: AIModel): Promise<void> {
    this.busy = true;
    console.log(
      "[Margin:popover] runAssistantTurn model=" +
        model.name +
        " messages=" +
        this.messages.length
    );

    let acc = "";
    const aiBubble = this.messagesEl!.createDiv({
      cls: "ai-popover-msg ai-popover-msg-model",
    });
    const roleEl = aiBubble.createDiv({ cls: "ai-popover-msg-role" });
    roleEl.createSpan({ cls: "ai-loading-spinner" });
    const contentEl = aiBubble.createDiv({
      cls: "ai-popover-msg-content",
      text: "",
    });
    const copyBtn = aiBubble.createEl("button", {
      cls: "ai-popover-msg-copy",
      attr: { type: "button", title: "复制本条消息" },
    });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(acc);
    });

    const provider = getProvider(model.provider);
    try {
      // 关联笔记上下文（输入框内可删除标签）
      let noteCtx = "";
      if (this.attachedNotes.length > 0) {
        const blocks: string[] = [];
        for (const n of this.attachedNotes) {
          const f = this.plugin.app.vault.getAbstractFileByPath(n.path);
          if (!(f instanceof TFile)) continue;
          try {
            const content = await this.plugin.app.vault.cachedRead(f);
            blocks.push(`[[${n.basename}]]\n\n${content}`);
          } catch (err) {
            console.warn("[Margin:popover] 读取关联笔记失败", n.path, err);
          }
        }
        if (blocks.length > 0) {
          noteCtx = `\n\n# 关联笔记\n${blocks.join("\n\n---\n\n")}`;
        }
      }
      const sys = this.plugin.settings.systemInstruction;
      const systemInstruction = (sys ? sys + "\n\n" : "") + noteCtx;

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
            roleEl.setText("AI");
            this.messages.push({ role: "model", content: acc });
            this.lastResult = acc;
            this.renderActions();
            this.renderUsage(u);
          },
          onError: (e) => {
            console.error("[Margin:popover] chat error", e);
            roleEl.setText("AI");
            new Notice("错误：" + e.message);
            contentEl.setText("⚠️ " + e.message);
            const retryBtn = aiBubble.createEl("button", {
              cls: "ai-popover-msg-retry",
              attr: { type: "button", title: "重新获取这一轮回答" },
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
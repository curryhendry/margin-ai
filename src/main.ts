import { Plugin, Editor, Menu, Notice, MarkdownView, Workspace, EventRef } from "obsidian";
import {
  AIPluginSettings,
  DEFAULT_SETTINGS,
  AISettingsTab,
} from "./settings";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chatView";
import { SelectionPopover } from "./selection/popover";
import { detectObsidianLang, setLang, t } from "./i18n";

/** 自定义事件：margin:settings-changed（避免对 workspace 用 any） */
type MarginWorkspace = Workspace & {
  on(name: "margin:settings-changed", callback: () => void): EventRef;
  trigger(name: "margin:settings-changed"): void;
};

export default class AIPlugin extends Plugin {
  declare settings: AIPluginSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    // 界面语言：设置优先，auto 则跟随 Obsidian
    setLang(
      this.settings.language === "auto"
        ? detectObsidianLang()
        : this.settings.language
    );

    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

    this.addRibbonIcon("message-square", t("cmd.open_chat"), () => {
      void this.activateChat();
    });

    this.addCommand({
      id: "open-ai-chat",
      name: t("cmd.open_chat"),
      callback: () => void this.activateChat(),
    });

    // 划词：右键仅一个菜单项
    this.registerEvent(
      this.app.workspace.on(
        "editor-menu",
        (menu: Menu, editor: Editor) => {
          const selected = editor.getSelection();
          if (!selected) return;
          menu.addItem((item) => {
            item
              .setTitle("Margin")
              .setIcon("sparkles")
              .onClick(() => {
                const popover = new SelectionPopover(
                  this,
                  editor,
                  selected
                );
                popover.open();
              });
          });
        }
      )
    );

    this.addSettingTab(new AISettingsTab(this.app, this));

    // Cmd+P 命令面板 → 打开悬浮对话（带当前选区；无选区也可）
    this.addCommand({
      id: "open-margin-popover",
      name: t("cmd.open_popover"),
      callback: () => {
        // 优先活跃 markdown 视图；否则回退到最近的 markdown leaf
        // （右侧 Chat 视图聚焦时 activeLeaf 不是 MarkdownView，需 fallback）
        let view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            if (leaf.view instanceof MarkdownView) {
              view = leaf.view;
              break;
            }
          }
        }
        if (!view) {
          new Notice(t("popover.no_note"));
          return;
        }
        new SelectionPopover(this, view.editor, view.editor.getSelection()).open();
      },
    });

    // 设置变更后通知已打开的 chat 视图刷新模型列表
    this.registerEvent(
      (this.app.workspace as MarginWorkspace).on("margin:settings-changed", () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
        if (leaf) (leaf.view as ChatView).refreshModels();
      })
    );
  }

  onunload(): void {
    // 视图会随插件卸载自动清理
  }

  async activateChat(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<AIPluginSettings>
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    (this.app.workspace as MarginWorkspace).trigger("margin:settings-changed");
  }
}

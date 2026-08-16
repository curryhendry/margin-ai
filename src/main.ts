import { Plugin, WorkspaceLeaf, Editor, Menu, Notice, MarkdownView } from "obsidian";
import {
  AIPluginSettings,
  DEFAULT_SETTINGS,
  AISettingsTab,
} from "./settings";
import { ChatView, VIEW_TYPE_CHAT } from "./views/chatView";
import { SelectionPopover } from "./selection/popover";

export default class AIPlugin extends Plugin {
  declare settings: AIPluginSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

    this.addRibbonIcon("message-square", "打开 AI Chat", () => {
      this.activateChat();
    });

    this.addCommand({
      id: "open-ai-chat",
      name: "打开 AI Chat",
      callback: () => this.activateChat(),
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
      name: "打开 Margin 悬浮对话",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice("当前没有打开的笔记");
          return;
        }
        new SelectionPopover(this, view.editor, view.editor.getSelection()).open();
      },
    });

    // 设置变更后通知已打开的 chat 视图刷新模型列表
    this.registerEvent(
      (this.app.workspace as any).on("margin:settings-changed", () => {
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
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    (this.app.workspace as any).trigger("margin:settings-changed");
  }
}

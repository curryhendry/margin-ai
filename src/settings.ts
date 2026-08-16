import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type AIPlugin from "./main";

export type ProviderId = "gemini";

export interface AIModel {
  /** 唯一 ID */
  id: string;
  /** 模型名称，即发给 API 的 model 字段，例如 gemini-3.5-flash（用户录入，不写死） */
  name: string;
  /** 供应商，初期仅 gemini，结构可扩展 */
  provider: ProviderId;
  /** API Key，用户录入 */
  apiKey: string;
  /** 可选：自定义 base URL（用于代理 / 兼容网关） */
  baseUrl?: string;
}

export interface AIPluginSettings {
  /** 模型列表，可添加多个、各自独立的 key */
  models: AIModel[];
  /** 默认模型 ID */
  defaultModelId: string;
  /** 划词结果“插入”时的落点 */
  insertMode: "cursor" | "after";
  /** 全局系统指令（可选） */
  systemInstruction: string;
}

export const DEFAULT_SETTINGS: AIPluginSettings = {
  models: [],
  defaultModelId: "",
  insertMode: "cursor",
  systemInstruction: "",
};

export class AISettingsTab extends PluginSettingTab {
  plugin: AIPlugin;

  constructor(app: App, plugin: AIPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Margin 设置" });

    // ---- 添加模型 ----
    containerEl.createEl("h3", { text: "添加模型" });
    containerEl.createEl("p", {
      cls: "ai-set-hint",
      text: "模型名称填写你想要的型号（如 gemini-3.5-flash），API Key 从 Google AI Studio 获取。可添加多个并随时切换。",
    });

    const addWrap = containerEl.createDiv({ cls: "ai-set-add" });
    const nameInput = addWrap.createEl("input", {
      cls: "ai-set-input",
      placeholder: "模型名称，如 gemini-3.5-flash",
    });
    const keyInput = addWrap.createEl("input", {
      cls: "ai-set-input",
      placeholder: "API Key",
      type: "password",
    });
    const addBtn = addWrap.createEl("button", {
      cls: "ai-set-add-btn mod-cta",
      text: "添加模型",
    });
    addBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      if (!name || !key) {
        new Notice("请填写模型名称和 API Key");
        return;
      }
      const model: AIModel = {
        id: "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name,
        provider: "gemini",
        apiKey: key,
      };
      this.plugin.settings.models.push(model);
      if (!this.plugin.settings.defaultModelId) {
        this.plugin.settings.defaultModelId = model.id;
      }
      await this.plugin.saveSettings();
      this.display();
    });

    // ---- 已添加模型列表 ----
    containerEl.createEl("h3", { text: "已添加模型" });
    if (this.plugin.settings.models.length === 0) {
      containerEl.createEl("p", {
        cls: "ai-set-empty",
        text: "还没有模型，先在上方添加。",
      });
    }
    this.plugin.settings.models.forEach((m) => {
      const row = containerEl.createDiv({ cls: "ai-set-model-row" });
      row.createEl("span", { cls: "ai-set-model-name", text: m.name });
      row.createEl("span", { cls: "ai-set-model-provider", text: m.provider });

      const isDefault = this.plugin.settings.defaultModelId === m.id;
      const def = row.createEl("button", {
        cls: "ai-set-model-default" + (isDefault ? " is-default" : ""),
        text: isDefault ? "默认 ✓" : "设为默认",
      });
      def.addEventListener("click", async () => {
        this.plugin.settings.defaultModelId = m.id;
        await this.plugin.saveSettings();
        this.display();
      });

      const del = row.createEl("button", {
        cls: "ai-set-model-del",
        text: "删除",
      });
      del.addEventListener("click", async () => {
        this.plugin.settings.models = this.plugin.settings.models.filter(
          (x) => x.id !== m.id
        );
        if (this.plugin.settings.defaultModelId === m.id) {
          this.plugin.settings.defaultModelId =
            this.plugin.settings.models[0]?.id ?? "";
        }
        await this.plugin.saveSettings();
        this.display();
      });
    });

    // ---- 默认模型下拉（备用切换入口） ----
    new Setting(containerEl)
      .setName("默认模型")
      .setDesc("新对话 / 划词使用的默认模型")
      .addDropdown((d) => {
        this.plugin.settings.models.forEach((m) => d.addOption(m.id, m.name));
        d.setValue(this.plugin.settings.defaultModelId);
        d.onChange(async (v) => {
          this.plugin.settings.defaultModelId = v;
          await this.plugin.saveSettings();
        });
      });

    // ---- 插入落点 ----
    new Setting(containerEl)
      .setName("划词结果插入位置")
      .setDesc("在划词悬浮框点击「插入」时的落点")
      .addDropdown((d) => {
        d.addOption("cursor", "光标处");
        d.addOption("after", "选区之后");
        d.setValue(this.plugin.settings.insertMode);
        d.onChange(async (v) => {
          this.plugin.settings.insertMode = v as "cursor" | "after";
          await this.plugin.saveSettings();
        });
      });

    // ---- 系统指令 ----
    new Setting(containerEl)
      .setName("系统指令（可选）")
      .setDesc("追加给模型的全局设定，例如“用简洁中文回答”")
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.systemInstruction);
        t.onChange(async (v) => {
          this.plugin.settings.systemInstruction = v;
          await this.plugin.saveSettings();
        });
      });
  }
}

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type AIPlugin from "./main";
import { testGeminiModel } from "./llm/gemini";

export type ProviderId = "gemini";

export interface AIModel {
  /** 唯一 ID */
  id: string;
  /** 模型名称，即发给 API 的 model 字段，例如 gemini-3.5-flash（用户录入，不写硬） */
  name: string;
  /** 供应商，初期仅 gemini，结构可扩展 */
  provider: ProviderId;
  /** API Key，用户录入 */
  apiKey: string;
  /** 可选：自定义 base URL（用于代理 / 兼容网关） */
  baseUrl?: string;
  /** 测试连接后回填：上下文 token 上限 */
  inputTokenLimit?: number;
  /** 测试连接后回填：单次输出 token 上限 */
  outputTokenLimit?: number;
}

export interface AIPluginSettings {
  /** 模型列表，可添加多个、各自独立的 key */
  models: AIModel[];
  /** 默认模型 ID */
  defaultModelId: string;
  /** 全局系统指令（可选） */
  systemInstruction: string;
}

export const DEFAULT_SETTINGS: AIPluginSettings = {
  models: [],
  defaultModelId: "",
  systemInstruction: "",
};

/** 把 1048576 这类数字格式化成 1M / 8K，更易读 */
export function fmtLimit(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "K";
  return String(n);
}

/** 模型行展示用的限额文本；任一缺失则不显示对应段 */
export function modelLimitsText(m: AIModel): string {
  const inL = m.inputTokenLimit != null ? `上下文 ${fmtLimit(m.inputTokenLimit)}` : null;
  const outL = m.outputTokenLimit != null ? `输出 ${fmtLimit(m.outputTokenLimit)}` : null;
  const parts = [inL, outL].filter(Boolean) as string[];
  return parts.join(" · ");
}

/**
 * 创建带“眼睛”切换明文的 Key 输入框。
 */
function createKeyInput(container: HTMLElement, value = ""): HTMLInputElement {
  const wrap = container.createDiv({ cls: "ai-set-key-wrap" });
  const input = wrap.createEl("input", {
    cls: "ai-set-input ai-set-key-input",
    placeholder: "API Key",
    type: "password",
    value,
  });
  const eye = wrap.createEl("button", {
    cls: "ai-set-eye",
    text: "👁",
    attr: { type: "button", title: "显示 / 隐藏" },
  });
  eye.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    eye.setText(show ? "🙈" : "👁");
  });
  return input;
}

export class AISettingsTab extends PluginSettingTab {
  plugin: AIPlugin;

  constructor(app: App, plugin: AIPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ai-set");

    containerEl.createEl("h2", { text: "Margin 设置" });

    this.renderAddModel(containerEl);
    this.renderModelList(containerEl);
    this.renderGeneral(containerEl);
  }

  /** 添加模型 */
  private renderAddModel(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "ai-set-card" });
    card.createEl("h3", { text: "添加模型" });
    card.createEl("p", {
      cls: "ai-set-hint",
      text: "模型名称填你想要的型号（如 gemini-3.5-flash），API Key 从 Google AI Studio 获取。可添加多个并随时切换。",
    });

    const addWrap = card.createDiv({ cls: "ai-set-add" });
    const nameInput = addWrap.createEl("input", {
      cls: "ai-set-input",
      placeholder: "模型名称，如 gemini-3.5-flash",
    });
    const keyInput = createKeyInput(addWrap);
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
        id:
          "m_" +
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 6),
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
  }

  /** 模型列表 */
  private renderModelList(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "ai-set-card" });
    card.createEl("h3", { text: "已添加模型" });

    if (this.plugin.settings.models.length === 0) {
      card.createEl("p", {
        cls: "ai-set-empty",
        text: "还没有模型，先在上方添加。",
      });
      return;
    }

    this.plugin.settings.models.forEach((m) => {
      const row = card.createDiv({ cls: "ai-set-model-row" });

      const info = row.createDiv({ cls: "ai-set-model-info" });
      info.createEl("span", { cls: "ai-set-model-name", text: m.name });
      info.createEl("span", { cls: "ai-set-model-provider", text: m.provider });
      const limitsSpan = info.createEl("span", {
        cls: "ai-set-model-limits",
        text: modelLimitsText(m),
      });
      if (!limitsSpan.getText()) limitsSpan.setText("未测试");

      const actions = row.createDiv({ cls: "ai-set-model-actions" });

      const isDefault = this.plugin.settings.defaultModelId === m.id;
      const def = actions.createEl("button", {
        cls: "ai-set-model-btn" + (isDefault ? " is-default" : ""),
        text: isDefault ? "默认 ✓" : "设为默认",
      });
      def.addEventListener("click", async () => {
        this.plugin.settings.defaultModelId = m.id;
        await this.plugin.saveSettings();
        this.display();
      });

      // 测试连接 → 拉取限额并回填
      const testBtn = actions.createEl("button", {
        cls: "ai-set-model-btn",
        text: "测试",
      });
      testBtn.addEventListener("click", async () => {
        testBtn.setText("测试中…");
        const r = await testGeminiModel(m);
        if (r.ok && r.meta) {
          m.inputTokenLimit = r.meta.inputTokenLimit;
          m.outputTokenLimit = r.meta.outputTokenLimit;
          await this.plugin.saveSettings();
          new Notice(
            `✓ ${m.name} 连接成功 · ${modelLimitsText(m) || "无限额信息"}`
          );
          this.display();
        } else {
          new Notice("✗ 测试失败：" + (r.error || "未知错误"));
          testBtn.setText("测试");
        }
      });

      const edit = actions.createEl("button", {
        cls: "ai-set-model-btn",
        text: "修改",
      });
      edit.addEventListener("click", () => this.renderEditForm(row, m));

      const del = actions.createEl("button", {
        cls: "ai-set-model-btn ai-set-model-del",
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
  }

  /** 行内编辑 */
  private renderEditForm(row: HTMLElement, m: AIModel): void {
    row.empty();
    row.addClass("is-editing");

    const nameInput = row.createEl("input", {
      cls: "ai-set-input",
      value: m.name,
      placeholder: "模型名称",
    });
    const keyInput = createKeyInput(row, m.apiKey);
    const urlInput = row.createEl("input", {
      cls: "ai-set-input",
      value: m.baseUrl ?? "",
      placeholder: "base URL（可选，代理 / 网关用）",
    });

    const btnWrap = row.createDiv({ cls: "ai-set-model-actions" });
    const save = btnWrap.createEl("button", {
      cls: "ai-set-model-btn mod-cta",
      text: "保存",
    });
    save.addEventListener("click", async () => {
      m.name = nameInput.value.trim() || m.name;
      m.apiKey = keyInput.value.trim() || m.apiKey;
      m.baseUrl = urlInput.value.trim() || undefined;
      await this.plugin.saveSettings();
      this.display();
    });
    const cancel = btnWrap.createEl("button", {
      cls: "ai-set-model-btn",
      text: "取消",
    });
    cancel.addEventListener("click", () => this.display());
  }

  /** 默认模型下拉 + 系统指令 */
  private renderGeneral(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "ai-set-card" });

    new Setting(card)
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

    new Setting(card)
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
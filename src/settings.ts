import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type AIPlugin from "./main";
import { testGeminiModel } from "./llm/gemini";
import { detectObsidianLang, setLang, t, tf, type Lang } from "./i18n";

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
  /** 界面语言：auto=跟随 Obsidian */
  language: "auto" | "zh" | "en";
}

export const DEFAULT_SETTINGS: AIPluginSettings = {
  models: [],
  defaultModelId: "",
  systemInstruction: "",
  language: "auto",
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
  const inL =
    m.inputTokenLimit != null
      ? tf("settings.limit_context", { n: fmtLimit(m.inputTokenLimit) })
      : null;
  const outL =
    m.outputTokenLimit != null
      ? tf("settings.limit_output", { n: fmtLimit(m.outputTokenLimit) })
      : null;
  const parts = [inL, outL].filter(Boolean);
  return parts.join(" · ");
}

/**
 * 创建带“眼睛”切换明文的 Key 输入框。
 */
function createKeyInput(container: HTMLElement, value = ""): HTMLInputElement {
  const wrap = container.createDiv({ cls: "ai-set-key-wrap" });
  const input = wrap.createEl("input", {
    cls: "ai-set-input ai-set-key-input",
    placeholder: t("settings.api_key"),
    type: "password",
    value,
  });
  const eye = wrap.createEl("button", {
    cls: "ai-set-eye",
    text: "👁",
    attr: { type: "button", title: t("settings.eye") },
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

    new Setting(containerEl).setName(t("settings.title")).setHeading();

    this.renderLanguage(containerEl);
    this.renderAddModel(containerEl);
    this.renderModelList(containerEl);
    this.renderGeneral(containerEl);
  }

  /** 界面语言 */
  private renderLanguage(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "ai-set-card" });
    new Setting(card)
      .setName(t("settings.language"))
      .addDropdown((d) => {
        d.addOption("auto", t("settings.lang_auto"));
        d.addOption("zh", t("settings.lang_zh"));
        d.addOption("en", t("settings.lang_en"));
        d.setValue(this.plugin.settings.language);
        d.onChange((v) => {
          this.plugin.settings.language = v as "auto" | "zh" | "en";
          setLang(v === "auto" ? detectObsidianLang() : (v as Lang));
          void this.plugin.saveSettings().then(() => this.display());
        });
      });
  }

  /** 添加模型 */
  private renderAddModel(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "ai-set-card" });
    new Setting(card).setName(t("settings.add_model")).setHeading();
    card.createEl("p", {
      cls: "ai-set-hint",
      text: t("settings.add_hint"),
    });

    const addWrap = card.createDiv({ cls: "ai-set-add" });
    const nameInput = addWrap.createEl("input", {
      cls: "ai-set-input",
      placeholder: t("settings.model_name_placeholder"),
    });
    const keyInput = createKeyInput(addWrap);
    const addBtn = addWrap.createEl("button", {
      cls: "ai-set-add-btn mod-cta",
      text: t("settings.add_model"),
    });
    addBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      if (!name || !key) {
        new Notice(t("settings.need_name_key"));
        return;
      }
      void this.addModel(name, key);
    });
  }

  /** 添加模型（提取自 addBtn handler，避免 async 箭头被 lint 标记） */
  private async addModel(name: string, key: string): Promise<void> {
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
  }

  /** 模型列表 */
  private renderModelList(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "ai-set-card" });
    new Setting(card).setName(t("settings.models")).setHeading();

    if (this.plugin.settings.models.length === 0) {
      card.createEl("p", {
        cls: "ai-set-empty",
        text: t("settings.empty"),
      });
      return;
    }

    this.plugin.settings.models.forEach((m) => {
      const row = card.createDiv({ cls: "ai-set-model-row" });

      const info = row.createDiv({ cls: "ai-set-model-info" });
      info.createSpan({ cls: "ai-set-model-name", text: m.name });
      info.createSpan({ cls: "ai-set-model-provider", text: m.provider });
      const limitsSpan = info.createSpan({
        cls: "ai-set-model-limits",
        text: modelLimitsText(m),
      });
      if (!limitsSpan.getText()) limitsSpan.setText(t("settings.untested"));

      const actions = row.createDiv({ cls: "ai-set-model-actions" });

      const isDefault = this.plugin.settings.defaultModelId === m.id;
      const def = actions.createEl("button", {
        cls: "ai-set-model-btn" + (isDefault ? " is-default" : ""),
        text: isDefault ? t("settings.is_default") : t("settings.set_default"),
      });
      def.addEventListener("click", () => {
        void this.setDefaultModel(m.id);
      });

      // 测试连接 → 拉取限额并回填
      const testBtn = actions.createEl("button", {
        cls: "ai-set-model-btn",
        text: t("settings.test"),
      });
      testBtn.addEventListener("click", () => {
        void this.testModel(m, testBtn);
      });

      const edit = actions.createEl("button", {
        cls: "ai-set-model-btn",
        text: t("settings.edit"),
      });
      edit.addEventListener("click", () => this.renderEditForm(row, m));

      const del = actions.createEl("button", {
        cls: "ai-set-model-btn ai-set-model-del",
        text: t("settings.delete"),
      });
      del.addEventListener("click", () => {
        void this.deleteModel(m);
      });
    });
  }

  /** 设为默认（提取自 def 按钮 handler） */
  private async setDefaultModel(id: string): Promise<void> {
    this.plugin.settings.defaultModelId = id;
    await this.plugin.saveSettings();
    this.display();
  }

  /** 测试连接并回填限额（提取自 testBtn handler） */
  private async testModel(m: AIModel, testBtn: HTMLButtonElement): Promise<void> {
    testBtn.setText(t("settings.testing"));
    const r = await testGeminiModel(m);
    if (r.ok && r.meta) {
      m.inputTokenLimit = r.meta.inputTokenLimit;
      m.outputTokenLimit = r.meta.outputTokenLimit;
      await this.plugin.saveSettings();
      new Notice(
        tf("settings.test_ok", {
          name: m.name,
          limits: modelLimitsText(m) || t("settings.no_limits"),
        })
      );
      this.display();
    } else {
      new Notice(
        t("settings.test_fail_prefix") + (r.error || t("settings.unknown_error"))
      );
      testBtn.setText(t("settings.test"));
    }
  }

  /** 删除模型（提取自 del 按钮 handler） */
  private async deleteModel(m: AIModel): Promise<void> {
    this.plugin.settings.models = this.plugin.settings.models.filter(
      (x) => x.id !== m.id
    );
    if (this.plugin.settings.defaultModelId === m.id) {
      this.plugin.settings.defaultModelId =
        this.plugin.settings.models[0]?.id ?? "";
    }
    await this.plugin.saveSettings();
    this.display();
  }

  /** 行内编辑 */
  private renderEditForm(row: HTMLElement, m: AIModel): void {
    row.empty();
    row.addClass("is-editing");

    const nameInput = row.createEl("input", {
      cls: "ai-set-input",
      value: m.name,
      placeholder: t("settings.model_name"),
    });
    const keyInput = createKeyInput(row, m.apiKey);
    const urlInput = row.createEl("input", {
      cls: "ai-set-input",
      value: m.baseUrl ?? "",
      placeholder: t("settings.base_url_placeholder"),
    });

    const btnWrap = row.createDiv({ cls: "ai-set-model-actions" });
    const save = btnWrap.createEl("button", {
      cls: "ai-set-model-btn mod-cta",
      text: t("settings.save"),
    });
    save.addEventListener("click", () => {
      m.name = nameInput.value.trim() || m.name;
      m.apiKey = keyInput.value.trim() || m.apiKey;
      m.baseUrl = urlInput.value.trim() || undefined;
      void this.plugin.saveSettings().then(() => this.display());
    });
    const cancel = btnWrap.createEl("button", {
      cls: "ai-set-model-btn",
      text: t("settings.cancel"),
    });
    cancel.addEventListener("click", () => this.display());
  }

  /** 默认模型下拉 + 系统指令 */
  private renderGeneral(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "ai-set-card" });

    new Setting(card)
      .setName(t("settings.default_model"))
      .setDesc(t("settings.default_model_desc"))
      .addDropdown((d) => {
        this.plugin.settings.models.forEach((m) => d.addOption(m.id, m.name));
        d.setValue(this.plugin.settings.defaultModelId);
        d.onChange((v) => {
          this.plugin.settings.defaultModelId = v;
          void this.plugin.saveSettings();
        });
      });

    new Setting(card)
      .setName(t("settings.system_instruction"))
      .setDesc(t("settings.system_instruction_desc"))
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.systemInstruction);
        ta.onChange((v) => {
          this.plugin.settings.systemInstruction = v;
          void this.plugin.saveSettings();
        });
      });
  }
}
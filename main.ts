import {
  App,
  Editor,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl,
} from "obsidian";

// ---- プラットフォーム定義（v1.0: X + LinkedIn） ----
interface PlatformDef {
  key: string;
  label: string;
  limit: number; // 文字数の目安（カウンタ表示用）
  defaultCount: number; // 生成案数
  rules: string; // プロンプトに差すプラットフォーム固有ルール
}

const PLATFORMS: Record<string, PlatformDef> = {
  x: {
    key: "x",
    label: "X (Twitter)",
    limit: 280,
    defaultCount: 3,
    rules: [
      "- Each post must be 280 characters or fewer.",
      "- Each post must stand on its own (no 1/3 threading).",
      "- Vary the angle or hook across the posts.",
      "- Avoid hashtags unless they read naturally.",
    ].join("\n"),
  },
  linkedin: {
    key: "linkedin",
    label: "LinkedIn",
    limit: 3000,
    defaultCount: 2,
    rules: [
      "- Open with a strong one-line hook, then a body in short paragraphs, then a soft CTA or question.",
      "- Use line breaks generously for readability.",
      "- Aim for 600-1300 characters; never exceed ~3000.",
      "- Professional tone, minimal emoji.",
    ].join("\n"),
  },
};

// ---- トーンプリセット ----
const TONE_PRESETS: Record<string, string> = {
  default: "",
  no_hype:
    "Tone: factual and grounded. No hype, no clickbait, no exaggerated or unverifiable claims. Never overpromise.",
  warm: "Tone: warm, conversational, written in the first person.",
  punchy:
    "Tone: punchy and bold with a strong hook, but still honest and specific.",
};

// ---- 履歴 ----
interface DraftHistory {
  ts: number;
  platform: string; // PLATFORMS のキー
  sourcePreview: string;
  posts: string[];
}

// ---- Anthropic API レスポンス型 ----
interface AnthropicResponse {
  error?: { message?: string };
  content?: Array<{ type: string; text?: string }>;
}

const MAX_HISTORY = 15;

// ---- 設定 ----
interface PostcraftSettings {
  apiKey: string;
  model: string;
  numXPosts: number; // X の生成案数（LinkedIn は 2 固定）
  voiceSamples: string; // 過去投稿のfew-shotサンプル
  tonePreset: string;
  history: DraftHistory[];
}

const DEFAULT_SETTINGS: PostcraftSettings = {
  apiKey: "",
  model: "claude-opus-4-8",
  numXPosts: 3,
  voiceSamples: "",
  tonePreset: "default",
  history: [],
};

export default class PostcraftPlugin extends Plugin {
  settings: PostcraftSettings;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "generate-x-posts-from-selection",
      name: "Generate X posts from selection",
      editorCallback: (editor: Editor) => this.handleGenerate(editor, "x"),
    });

    this.addCommand({
      id: "generate-linkedin-posts-from-selection",
      name: "Generate LinkedIn posts from selection",
      editorCallback: (editor: Editor) =>
        this.handleGenerate(editor, "linkedin"),
    });

    this.addCommand({
      id: "show-recent-drafts",
      name: "Show recent drafts",
      callback: () => {
        if (this.settings.history.length === 0) {
          new Notice("No drafts yet.");
          return;
        }
        new HistoryModal(this.app, this).open();
      },
    });

    // 右クリックメニュー（選択中のみ）
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        if (editor.getSelection().trim().length === 0) return;
        menu.addItem((item) => {
          item
            .setTitle("Postcraft: X posts")
            .setIcon("send")
            .onClick(() => this.handleGenerate(editor, "x"));
        });
        menu.addItem((item) => {
          item
            .setTitle("Postcraft: LinkedIn posts")
            .setIcon("send")
            .onClick(() => this.handleGenerate(editor, "linkedin"));
        });
      })
    );

    this.addSettingTab(new PostcraftSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PostcraftSettings>
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async handleGenerate(editor: Editor, platformKey: string) {
    const platform = PLATFORMS[platformKey];
    const selection = editor.getSelection().trim();
    if (!selection) {
      new Notice("Select some text first.");
      return;
    }
    if (!this.settings.apiKey) {
      new Notice("Set your Claude API key in Postcraft settings.");
      return;
    }

    const notice = new Notice(`Postcraft: generating ${platform.label}…`, 0);
    try {
      const posts = await this.generate(selection, platform);
      notice.hide();

      // 履歴に保存
      this.settings.history.unshift({
        ts: Date.now(),
        platform: platform.key,
        sourcePreview: selection.slice(0, 80),
        posts,
      });
      this.settings.history = this.settings.history.slice(0, MAX_HISTORY);
      await this.saveSettings();

      new ResultsModal(this.app, posts, platform).open();
    } catch (e) {
      notice.hide();
      console.error("Postcraft error:", e);
      new Notice(
        `Postcraft failed: ${e instanceof Error ? e.message : "unknown error"}`
      );
    }
  }

  buildPrompt(text: string, platform: PlatformDef, n: number): string {
    const voiceBlock = this.settings.voiceSamples.trim()
      ? `Match this writer's voice. Here are samples of their past posts:\n"""\n${this.settings.voiceSamples.trim()}\n"""\n`
      : "";
    const tone = TONE_PRESETS[this.settings.tonePreset] || "";

    return [
      `You are an expert social media copywriter. Convert the note below into ${n} distinct ${platform.label} posts.`,
      voiceBlock,
      tone,
      "Rules:",
      platform.rules,
      "- Write in the same language as the note.",
      "- Do not invent facts that are not in the note.",
      "",
      "Note:",
      '"""',
      text,
      '"""',
    ]
      .filter((s) => s !== "")
      .join("\n");
  }

  async generate(text: string, platform: PlatformDef): Promise<string[]> {
    const n =
      platform.key === "x" ? this.settings.numXPosts : platform.defaultCount;
    const prompt = this.buildPrompt(text, platform, n);

    const response = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      contentType: "application/json",
      headers: {
        "x-api-key": this.settings.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.settings.model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                posts: { type: "array", items: { type: "string" } },
              },
              required: ["posts"],
              additionalProperties: false,
            },
          },
        },
      }),
      throw: false,
    });

    const json = response.json as AnthropicResponse;
    if (response.status !== 200) {
      const msg = json?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(msg);
    }

    const textBlock = json?.content?.find((b) => b.type === "text");
    if (!textBlock?.text) {
      throw new Error("Empty response from Claude.");
    }

    let parsed: { posts?: string[] };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      throw new Error("Could not parse Claude's response.");
    }
    if (!parsed.posts || parsed.posts.length === 0) {
      throw new Error("No posts returned.");
    }
    return parsed.posts;
  }
}

// ---- 結果モーダル：編集可能なtextarea＋文字数カウンタ＋コピー ----
class ResultsModal extends Modal {
  posts: string[];
  platform: PlatformDef;

  constructor(app: App, posts: string[], platform: PlatformDef) {
    super(app);
    this.posts = posts;
    this.platform = platform;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `Postcraft — ${this.platform.label} drafts` });

    this.posts.forEach((post) => {
      const card = contentEl.createDiv({ cls: "postcraft-card" });

      const area = card.createEl("textarea", { cls: "postcraft-area" });
      area.value = post;
      area.rows = this.platform.key === "linkedin" ? 8 : 3;

      const footer = card.createDiv({ cls: "postcraft-footer" });
      const counter = footer.createEl("span");

      const update = () => {
        const len = area.value.length;
        counter.setText(`${len}/${this.platform.limit}`);
        counter.className =
          len > this.platform.limit
            ? "postcraft-count-over"
            : "postcraft-count";
      };
      update();
      area.addEventListener("input", update);

      const copyBtn = footer.createEl("button", { text: "Copy" });
      copyBtn.onclick = async () => {
        await navigator.clipboard.writeText(area.value);
        new Notice("Copied to clipboard.");
      };
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---- 履歴モーダル：直近の生成を再表示 ----
class HistoryModal extends Modal {
  plugin: PostcraftPlugin;

  constructor(app: App, plugin: PostcraftPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Postcraft — recent drafts" });

    this.plugin.settings.history.forEach((h) => {
      const platform = PLATFORMS[h.platform] ?? PLATFORMS.x;
      const row = contentEl.createDiv({ cls: "postcraft-card" });
      row.createEl("div", {
        text: `[${platform.label}] ${h.sourcePreview}…`,
        cls: "postcraft-text",
      });
      const openBtn = row.createEl("button", { text: "Open" });
      openBtn.onclick = () => {
        this.close();
        new ResultsModal(this.app, h.posts, platform).open();
      };
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---- 設定タブ ----
class PostcraftSettingTab extends PluginSettingTab {
  plugin: PostcraftPlugin;

  constructor(app: App, plugin: PostcraftPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Claude API key")
      .setDesc(
        "Your Anthropic API key (sk-ant-…). Stored locally in this vault, never sent anywhere except Anthropic."
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-ant-…")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    const keyHint = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    keyHint.appendText("Get a key at ");
    keyHint.createEl("a", {
      text: "console.anthropic.com",
      href: "https://console.anthropic.com/settings/keys",
    });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Claude model used to generate posts.")
      .addDropdown((dd) => {
        dd.addOption("claude-opus-4-8", "Claude Opus 4.8 (best quality)");
        dd.addOption(
          "claude-sonnet-4-6",
          "Claude Sonnet 4.6 (cheaper, faster)"
        );
        dd.setValue(this.plugin.settings.model).onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Number of X drafts")
      .setDesc("How many X variations to generate per run (LinkedIn is fixed at 2).")
      .addSlider((slider) => {
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.numXPosts)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.numXPosts = value;
            await this.plugin.saveSettings();
          });
      });

    // ---- 声プロファイル ----
    new Setting(containerEl).setName("Voice").setHeading();

    new Setting(containerEl)
      .setName("Tone preset")
      .setDesc("A baseline tone applied to every draft.")
      .addDropdown((dd) => {
        dd.addOption("default", "Default (no extra steering)");
        dd.addOption("no_hype", "No hype (factual, no clickbait)");
        dd.addOption("warm", "Warm & conversational");
        dd.addOption("punchy", "Punchy & bold");
        dd.setValue(this.plugin.settings.tonePreset).onChange(
          async (value) => {
            this.plugin.settings.tonePreset = value;
            await this.plugin.saveSettings();
          }
        );
      });

    new Setting(containerEl)
      .setName("Your voice samples")
      .setDesc(
        "Paste 3-5 of your past posts. Postcraft will match your style (leave empty to skip)."
      )
      .addTextArea((ta) => {
        ta.inputEl.rows = 6;
        ta.inputEl.addClass("postcraft-voice-input");
        ta.setPlaceholder("Paste a few of your real posts here…")
          .setValue(this.plugin.settings.voiceSamples)
          .onChange(async (value) => {
            this.plugin.settings.voiceSamples = value;
            await this.plugin.saveSettings();
          });
      });

    // ---- 履歴クリア ----
    new Setting(containerEl)
      .setName("Clear draft history")
      .setDesc(`Stored locally, up to ${MAX_HISTORY} recent runs.`)
      .addButton((btn) => {
        btn.setButtonText("Clear").onClick(async () => {
          this.plugin.settings.history = [];
          await this.plugin.saveSettings();
          new Notice("Draft history cleared.");
        });
      });
  }
}

# Postcraft

Turn a selected note into ready-to-post **X (Twitter)** and **LinkedIn** drafts with one click — in your own voice, without leaving Obsidian.

Most AI plugins are general-purpose chat. Postcraft does one thing well: you select text, run one command, and get finished posts you can edit and copy. No prompt writing.

## Features

- **Select → one click → drafts.** Command palette or right-click. Choose **X** or **LinkedIn**.
- **Matches your voice.** Paste a few of your past posts once; Postcraft writes in your style. Plus tone presets (e.g. "no hype — factual, no clickbait").
- **Edit in place.** Tweak each draft right in the result window, with a live character counter (turns red over the limit).
- **Recent drafts history.** Reopen your last runs anytime ("Show recent drafts").
- **Your key, your data.** Calls Anthropic directly via Obsidian's `requestUrl`; your API key stays in your vault and is never bundled into any web page.

## Setup

1. Install the plugin (see *Manual install* below until it's in the community store).
2. Open **Settings → Postcraft** and paste your Anthropic API key (`sk-ant-…`). Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys).
3. Pick a model (Opus = best quality, Sonnet = cheaper/faster), a tone preset, and optionally paste a few of your past posts under **Your voice samples**.

## Usage

1. Select some text in any note.
2. Run **"Generate X posts"** or **"Generate LinkedIn posts"** from the command palette, or right-click → **Postcraft: X posts / LinkedIn posts**.
3. Edit any draft in place, then copy the one you like.
4. Reopen past runs with **"Show recent drafts"**.

## Manual install (for local testing)

1. `npm install`
2. `npm run build` (produces `main.js`)
3. Copy `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/postcraft/`
4. Reload Obsidian and enable **Postcraft** in Settings → Community plugins.

## Development

- `npm run dev` — watch mode (rebuilds `main.js` on save)
- `npm run build` — type-check + production build

## Privacy

Postcraft sends only the text you select (plus your voice samples and the built-in instructions) to the Anthropic API, using the key you provide. Nothing is sent anywhere else. Your key and draft history live in `.obsidian/plugins/postcraft/data.json` inside your vault — keep that file out of any public sync/repo.

## License

MIT

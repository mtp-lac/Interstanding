# LLM Translator (OpenAI-Compatible)

This fork adds a built-in, configurable **LLM (OpenAI-Compatible)** translation module to Linguist, supporting OpenAI, OpenRouter, Groq, DeepSeek, Ollama, LM Studio, llama.cpp, and any OpenAI `/v1/chat/completions`-compatible endpoint, with customizable system and translation prompts in Settings.

## Loading the Built Extension

After building (`build/chrome` or `build/firefox`):

### Chrome / Edge / Brave
1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `build/chrome` directory.

### Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `build/firefox/manifest.json`.

## Configuration in Settings

1. Open Linguist **Settings**.
2. Under **Translation preferences -> Translation module**, select **LLM (OpenAI-Compatible)**.
3. Scroll to **LLM translator (OpenAI-compatible)** and configure:
   - **API base URL**: Endpoint base URL (or full `/chat/completions` URL).
   - **API key**: Bearer API key (leave empty for local servers without auth such as Ollama).
   - **Model**: Model identifier.
   - **Temperature**: Sampling temperature (`0` recommended for deterministic translations).
   - **System prompt**: Persona, tone, or glossary instructions.
   - **Custom translation prompt**: Prompt template for each translation request.
4. Click **Save changes** in the bottom bar. Updating LLM settings automatically clears the `LLMTranslator` translation cache so new prompts apply immediately.

### Supported Prompt Placeholders

Both **System prompt** and **Custom translation prompt** support:

| Placeholder | Description | Example |
|---|---|---|
| `{{from}}` | Source language name (or `auto`) | `English` or `auto` |
| `{{to}}` | Target language name | `Japanese` |
| `{{fromCode}}` | ISO 639-1 source code (or `auto`) | `en` or `auto` |
| `{{toCode}}` | ISO 639-1 target code | `ja` |
| `{{texts}}` | JSON array of input strings | `["Hello","World"]` |

> If your **Custom translation prompt** does not include `{{texts}}`, Linguist automatically appends JSON array formatting instructions and the serialized `{{texts}}` payload so batch and full-page translations remain reliable.

### Provider Examples

- **OpenAI**:
  - API base URL: `https://api.openai.com/v1`
  - Model: `gpt-4o-mini` (or `gpt-4.1-mini`)
- **OpenRouter**:
  - API base URL: `https://openrouter.ai/api/v1`
  - Model: `openai/gpt-4o-mini` (or `google/gemini-2.5-flash`)
- **Ollama (local)**:
  - API base URL: `http://localhost:11434/v1`
  - API key: *(leave empty)*
  - Model: `translategemma` (or `qwen2.5`, `gemma3`, `llama3.2`)
- **DeepSeek**:
  - API base URL: `https://api.deepseek.com/v1`
  - Model: `deepseek-chat`
- **Groq**:
  - API base URL: `https://api.groq.com/openai/v1`
  - Model: `llama-3.3-70b-versatile`

---

## Standalone Custom Translator Script (For Unmodified Linguist)

If you want to use an OpenAI-compatible LLM with an unmodified upstream Linguist installation via **Settings -> Custom translation modules -> Managing translators -> Add**, paste the script below and edit `CONFIG`:

```js
class OpenAILLMCustomTranslator {
	constructor() {
		this.config = {
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'YOUR_API_KEY', // Leave empty for local Ollama/llama.cpp
			model: 'gpt-4o-mini',
			temperature: 0,
			systemPrompt:
				'You are a professional translator. Translate accurately and naturally while preserving original meaning, tone, punctuation, and formatting. Never add explanations.',
			customPrompt:
				'Translate the following JSON array of texts from {{from}} to {{to}}.\nIf the source language is "auto", detect it automatically.\nReturn ONLY a valid JSON array of translated strings with the exact same length and order.\n\n{{texts}}',
		};
	}

	_resolveUrl() {
		const base = (this.config.apiUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
		return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
	}

	_langName(code) {
		if (code === 'auto') return 'auto';
		try {
			return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
		} catch {
			return code;
		}
	}

	_render(template, texts, from, to) {
		const replacements = {
			from: this._langName(from),
			to: this._langName(to),
			fromCode: from,
			toCode: to,
			texts: JSON.stringify(texts),
		};
		return template.replace(
			/\{\{(from|to|fromCode|toCode|texts)\}\}/g,
			(_, token) => replacements[token] ?? '',
		);
	}

	_cleanJson(raw) {
		let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
		const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
		if (fenced) cleaned = fenced[1].trim();
		const start = cleaned.indexOf('[');
		const end = cleaned.lastIndexOf(']');
		if (!cleaned.startsWith('[') && start !== -1 && end > start) {
			cleaned = cleaned.slice(start, end + 1);
		}
		return cleaned;
	}

	async translate(text, from, to) {
		const [result] = await this.translateBatch([text], from, to);
		return result;
	}

	async translateBatch(texts, from, to) {
		const systemPrompt = this._render(this.config.systemPrompt, texts, from, to).trim();
		let userPrompt = this._render(this.config.customPrompt, texts, from, to);
		if (!this.config.customPrompt.includes('{{texts}}')) {
			userPrompt += `\n\nReturn ONLY a valid JSON array of ${texts.length} translated strings:\n${JSON.stringify(texts)}`;
		}

		const messages = [];
		if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
		messages.push({ role: 'user', content: userPrompt });

		const headers = { 'Content-Type': 'application/json' };
		if (this.config.apiKey && this.config.apiKey.trim()) {
			headers['Authorization'] = `Bearer ${this.config.apiKey.trim()}`;
		}

		const response = await fetch(this._resolveUrl(), {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: this.config.model,
				messages,
				temperature: this.config.temperature,
			}),
		});

		if (!response.ok) {
			throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		const content = data?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') {
			throw new Error('Missing choices[0].message.content in LLM response');
		}

		const parsed = JSON.parse(this._cleanJson(content));
		if (!Array.isArray(parsed) || parsed.length !== texts.length) {
			throw new Error('LLM response must be a JSON array matching input length');
		}
		return parsed.map((item) => String(item));
	}

	getLengthLimit() {
		return 5000;
	}

	getRequestsTimeout() {
		return 500;
	}

	checkLimitExceeding(text) {
		const plain = Array.isArray(text) ? text.join('') : text;
		const extra = plain.length - this.getLengthLimit();
		return extra > 0 ? extra : 0;
	}

	static isSupportedAutoFrom() {
		return true;
	}

	static getSupportedLanguages() {
		return [
			'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'uk', 'pl', 'nl', 'cs', 'sk',
			'bg', 'ro', 'hu', 'el', 'tr', 'ar', 'he', 'fa', 'hi', 'bn', 'th', 'vi',
			'id', 'ms', 'ja', 'ko', 'zh', 'sv', 'da', 'fi', 'no', 'et', 'lv', 'lt',
		];
	}
}

OpenAILLMCustomTranslator;
```

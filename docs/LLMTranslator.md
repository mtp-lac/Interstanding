# LLM Translator (OpenAI-Compatible)

Interstanding includes a built-in **LLM (OpenAI-Compatible)** translator that works with any `/v1/chat/completions`-compatible endpoint (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, LM Studio, llama.cpp, etc.).

## Primary Configuration

- **API base URL**: Base URL for your primary OpenAI-compatible API (e.g., `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, `http://localhost:11434/v1`). `/chat/completions` is appended automatically if omitted.
- **API key**: Bearer token for authentication. Leave empty for local servers without authentication (such as Ollama).
- **Model**: Model identifier (e.g., `gpt-4o-mini`, `gpt-4.1-mini`, `deepseek-chat`, `qwen2.5`).
- **Temperature**: Sampling temperature (`0` recommended for deterministic translations).
- **System prompt**: System instructions defining translator persona, tone, or glossary.
- **Custom translation prompt**: Prompt template supporting `{{from}}`, `{{to}}`, `{{fromCode}}`, `{{toCode}}`, and `{{texts}}`.

## Fallback Endpoints & Models

You can configure an ordered list of **Fallback endpoints & models** (`llmTranslator.fallbacks`) in **Settings → Translator → LLM translator (OpenAI-compatible)**.

### When Fallback Triggers

When one or more fallbacks are configured, requests are tried in priority order (`primary` → `fallback #1` → `fallback #2` → ...). The translator automatically advances to the next candidate if the current endpoint fails due to:

1. **Network or transport errors** (timeouts, DNS failures, connection refused).
2. **HTTP / API errors** (e.g., `429 Too Many Requests`, `500`/`502`/`503` server errors, auth failures, missing `choices[0].message.content`).
3. **Invalid model output** (empty content, malformed JSON, non-array JSON, non-string array items, or mismatched translation count for the input batch).

If every configured endpoint fails, an aggregated error listing each attempted endpoint, model, and failure reason is thrown.

### Field Inheritance Rules

Each fallback entry supports `apiUrl`, `apiKey`, `model`, and an optional `temperature`:

- **Model-only fallback on the same endpoint**: Leave **API base URL** and **API key** blank and set only **Model** (e.g., primary `gpt-4o-mini` → fallback `gpt-4.1-mini`). Both the primary URL and API key are inherited automatically.
- **Cross-provider fallback**: Specify a different **API base URL**, **API key**, and **Model** (e.g., OpenAI primary → OpenRouter or Groq fallback).
- **Local unauthenticated fallback**: Specify a local **API base URL** (e.g., `http://localhost:11434/v1`) and leave **API key** blank. Because a custom URL is provided, the primary provider's API key is **not** sent to the local endpoint.
- **Temperature**: Leave blank to inherit the primary temperature, or set a numeric override per fallback.
- **Deduplication & blank rows**: Completely blank fallback rows are ignored, and exact duplicate `(apiUrl, apiKey, model, temperature)` entries are automatically skipped.

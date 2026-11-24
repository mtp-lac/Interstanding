import type { LLMFetcher } from 'anylang/translators';

import type { LLMTranslatorConfig } from '../../../types/runtime';

import type { LLMPromptMessages } from './promptBuilder';

export type OpenAICompatibleFetcherConfig = Pick<
	LLMTranslatorConfig,
	'apiUrl' | 'apiKey' | 'model' | 'temperature'
>;

export const resolveChatCompletionsUrl = (apiUrl: string): string => {
	const trimmed = apiUrl.trim().replace(/\/+$/, '');
	const base = trimmed || 'https://api.openai.com/v1';
	return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
};

export const cleanLLMJsonResponse = (raw: string): string => {
	let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

	const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(cleaned);
	if (fencedMatch) {
		cleaned = fencedMatch[1].trim();
	}

	const isDirectJsonArray = (() => {
		if (!cleaned.startsWith('[')) return false;
		try {
			return Array.isArray(JSON.parse(cleaned));
		} catch {
			return false;
		}
	})();

	if (!isDirectJsonArray) {
		const firstBracket = cleaned.indexOf('[');
		const lastBracket = cleaned.lastIndexOf(']');
		if (firstBracket !== -1 && lastBracket > firstBracket) {
			const candidate = cleaned.slice(firstBracket, lastBracket + 1);
			try {
				if (Array.isArray(JSON.parse(candidate))) {
					return candidate;
				}
			} catch {
				// Return cleaned string so caller's JSON.parse error triggers retry
			}
		}
	}

	return cleaned;
};

export const encodePromptEnvelope = (messages: LLMPromptMessages): string =>
	JSON.stringify({
		__llmEnvelope: true,
		systemPrompt: messages.systemPrompt,
		userPrompt: messages.userPrompt,
	});

export const decodePromptEnvelope = (prompt: string): LLMPromptMessages => {
	if (prompt.startsWith('{')) {
		try {
			const parsed = JSON.parse(prompt) as {
				__llmEnvelope?: unknown;
				systemPrompt?: unknown;
				userPrompt?: unknown;
			};
			if (
				parsed &&
				typeof parsed === 'object' &&
				parsed.__llmEnvelope === true &&
				typeof parsed.userPrompt === 'string'
			) {
				return {
					systemPrompt:
						typeof parsed.systemPrompt === 'string'
							? parsed.systemPrompt
							: '',
					userPrompt: parsed.userPrompt,
				};
			}
		} catch {
			// Fall back to plain user prompt
		}
	}

	return {
		systemPrompt: '',
		userPrompt: prompt,
	};
};

export class OpenAICompatibleLLMFetcher implements LLMFetcher {
	private readonly config: OpenAICompatibleFetcherConfig;

	constructor(config: OpenAICompatibleFetcherConfig) {
		this.config = config;
	}

	public getLengthLimit(): number {
		return 5000;
	}

	public getRequestsTimeout(): number {
		return 500;
	}

	public async fetch(prompt: string): Promise<string> {
		const { systemPrompt, userPrompt } = decodePromptEnvelope(prompt);
		const messages: { role: 'system' | 'user'; content: string }[] = [];
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}
		messages.push({ role: 'user', content: userPrompt });

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		const apiKey = this.config.apiKey.trim();
		if (apiKey !== '') {
			headers['Authorization'] = `Bearer ${apiKey}`;
		}

		const model = this.config.model.trim() || 'gpt-4o-mini';
		const temperature = Number.isFinite(this.config.temperature)
			? this.config.temperature
			: 0;

		const response = await fetch(resolveChatCompletionsUrl(this.config.apiUrl), {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model,
				messages,
				temperature,
			}),
		});

		if (!response.ok) {
			let errorDetail = response.statusText;
			try {
				const errorBody = (await response.json()) as {
					error?: { message?: string };
					message?: string;
				};
				const parsedMessage = errorBody?.error?.message ?? errorBody?.message;
				if (typeof parsedMessage === 'string' && parsedMessage.trim() !== '') {
					errorDetail = parsedMessage.trim();
				}
			} catch {
				// Ignore JSON parse error on non-JSON error responses
			}
			throw new Error(
				`LLM API request failed with status ${response.status}: ${errorDetail}`,
			);
		}

		const data = (await response.json()) as {
			choices?: { message?: { content?: unknown } }[];
		};
		const content = data?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') {
			throw new Error(
				'LLM API response did not contain choices[0].message.content',
			);
		}

		return cleanLLMJsonResponse(content);
	}
}

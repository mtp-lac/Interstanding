import type { LLMFetcher } from 'anylang/translators';

import type {
	LLMFallbackEndpointConfig,
	LLMTranslatorConfig,
} from '../../../types/runtime';

import type { LLMPromptMessages } from './promptBuilder';

export type OpenAICompatibleFetcherConfig = Pick<
	LLMTranslatorConfig,
	'apiUrl' | 'apiKey' | 'model' | 'temperature'
> & {
	fallbacks?: LLMFallbackEndpointConfig[];
};

export type ResolvedLLMEndpoint = {
	label: string;
	apiUrl: string;
	apiKey: string;
	model: string;
	temperature: number;
};

export type DecodedPromptEnvelope = LLMPromptMessages & {
	expectedLength?: number;
};

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

export const validateLLMJsonOutput = (
	cleaned: string,
	expectedLength?: number,
): string | null => {
	if (!cleaned.trim()) {
		return 'Response content was empty';
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return `Response is not valid JSON (${reason})`;
	}

	if (!Array.isArray(parsed)) {
		return 'Response JSON is not an array';
	}

	if (!parsed.every((item) => typeof item === 'string')) {
		return 'Response JSON array contains non-string elements';
	}

	if (
		typeof expectedLength === 'number' &&
		Number.isInteger(expectedLength) &&
		expectedLength >= 0 &&
		parsed.length !== expectedLength
	) {
		return `Expected ${expectedLength} translated item(s), received ${parsed.length}`;
	}

	return null;
};

export const encodePromptEnvelope = (
	messages: LLMPromptMessages,
	expectedLength?: number,
): string =>
	JSON.stringify({
		__llmEnvelope: true,
		systemPrompt: messages.systemPrompt,
		userPrompt: messages.userPrompt,
		...(typeof expectedLength === 'number' ? { expectedLength } : {}),
	});

export const decodePromptEnvelope = (prompt: string): DecodedPromptEnvelope => {
	if (prompt.startsWith('{')) {
		try {
			const parsed = JSON.parse(prompt) as {
				__llmEnvelope?: unknown;
				systemPrompt?: unknown;
				userPrompt?: unknown;
				expectedLength?: unknown;
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
					...(typeof parsed.expectedLength === 'number' &&
					Number.isInteger(parsed.expectedLength) &&
					parsed.expectedLength >= 0
						? { expectedLength: parsed.expectedLength }
						: {}),
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

export const resolveEndpointCandidates = (
	config: OpenAICompatibleFetcherConfig,
): ResolvedLLMEndpoint[] => {
	const primary: ResolvedLLMEndpoint = {
		label: 'primary',
		apiUrl: resolveChatCompletionsUrl(config.apiUrl),
		apiKey: config.apiKey.trim(),
		model: config.model.trim() || 'gpt-4o-mini',
		temperature: Number.isFinite(config.temperature) ? config.temperature : 0,
	};

	const candidates: ResolvedLLMEndpoint[] = [primary];
	const seen = new Set<string>([
		`${primary.apiUrl}\0${primary.apiKey}\0${primary.model}\0${primary.temperature}`,
	]);

	const fallbacks = Array.isArray(config.fallbacks) ? config.fallbacks : [];
	fallbacks.forEach((fallback, index) => {
		if (!fallback || typeof fallback !== 'object') {
			return;
		}

		const rawUrl = typeof fallback.apiUrl === 'string' ? fallback.apiUrl.trim() : '';
		const rawKey = typeof fallback.apiKey === 'string' ? fallback.apiKey.trim() : '';
		const rawModel = typeof fallback.model === 'string' ? fallback.model.trim() : '';

		// Skip completely empty rows
		if (!rawUrl && !rawKey && !rawModel) {
			return;
		}

		const resolvedUrl = rawUrl ? resolveChatCompletionsUrl(rawUrl) : primary.apiUrl;
		// Inherit primary API key only when reusing the primary endpoint (blank apiUrl).
		// When a custom endpoint URL is specified with a blank key (e.g. local Ollama),
		// do not leak the primary provider's API key.
		const resolvedKey = rawKey || (rawUrl ? '' : primary.apiKey);
		const resolvedModel = rawModel || primary.model;
		const resolvedTemp =
			typeof fallback.temperature === 'number' &&
			Number.isFinite(fallback.temperature)
				? fallback.temperature
				: primary.temperature;

		const dedupeKey = `${resolvedUrl}\0${resolvedKey}\0${resolvedModel}\0${resolvedTemp}`;
		if (seen.has(dedupeKey)) {
			return;
		}
		seen.add(dedupeKey);

		candidates.push({
			label: `fallback #${index + 1}`,
			apiUrl: resolvedUrl,
			apiKey: resolvedKey,
			model: resolvedModel,
			temperature: resolvedTemp,
		});
	});

	return candidates;
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

	private async fetchFromEndpoint(
		endpoint: ResolvedLLMEndpoint,
		messages: { role: 'system' | 'user'; content: string }[],
	): Promise<string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (endpoint.apiKey !== '') {
			headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
		}

		const response = await fetch(endpoint.apiUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: endpoint.model,
				messages,
				temperature: endpoint.temperature,
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

	public async fetch(prompt: string): Promise<string> {
		const { systemPrompt, userPrompt, expectedLength } = decodePromptEnvelope(prompt);
		const messages: { role: 'system' | 'user'; content: string }[] = [];
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}
		messages.push({ role: 'user', content: userPrompt });

		const candidates = resolveEndpointCandidates(this.config);
		const hasFallbacks = candidates.length > 1;
		const errors: { endpoint: ResolvedLLMEndpoint; error: unknown }[] = [];

		for (let i = 0; i < candidates.length; i++) {
			const candidate = candidates[i];
			try {
				const cleaned = await this.fetchFromEndpoint(candidate, messages);

				// When fallbacks are configured, validate the model's output format and
				// length so malformed or mismatched model output triggers fallback too.
				if (hasFallbacks) {
					const validationError = validateLLMJsonOutput(
						cleaned,
						expectedLength,
					);
					if (validationError !== null) {
						throw new Error(`Invalid LLM output: ${validationError}`);
					}
				}

				return cleaned;
			} catch (error) {
				errors.push({ endpoint: candidate, error });
				const hasNext = i < candidates.length - 1;
				if (hasNext) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.warn(
						`[LLMTranslator] ${candidate.label} (${candidate.model} @ ${candidate.apiUrl}) failed: ${message}. Falling back to ${candidates[i + 1].label}.`,
					);
				}
			}
		}

		if (errors.length === 1) {
			throw errors[0].error;
		}

		const summary = errors
			.map(({ endpoint, error }) => {
				const message = error instanceof Error ? error.message : String(error);
				return `- [${endpoint.label}] ${endpoint.model} @ ${endpoint.apiUrl}: ${message}`;
			})
			.join('\n');

		throw new Error(`All ${errors.length} LLM endpoints failed:\n${summary}`);
	}
}

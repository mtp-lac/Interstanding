import type { LLMFetcher } from 'anylang/translators';

import type {
	LLMFallbackEndpointConfig,
	LLMTranslatorConfig,
} from '../../../types/runtime';

import type { LLMPromptMessages } from './promptBuilder';

export const DEFAULT_THINKING_LEVELS = [
	'none',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
] as const;

export type OpenAICompatibleFetcherConfig = Pick<
	LLMTranslatorConfig,
	'apiUrl' | 'apiKey' | 'model' | 'temperature'
> & {
	thinkingLevel?: string;
	fallbacks?: LLMFallbackEndpointConfig[];
};

export type ResolvedLLMEndpoint = {
	label: string;
	apiUrl: string;
	apiKey: string;
	model: string;
	temperature: number;
	thinkingLevel: string;
};

export type EndpointModelInfo = {
	id: string;
	thinkingLevels: string[];
};

export type EndpointMetadataResult = {
	models: EndpointModelInfo[];
	thinkingLevels: string[];
};

export type DecodedPromptEnvelope = LLMPromptMessages & {
	expectedLength?: number;
};

export const normalizeThinkingLevel = (raw: unknown): string => {
	if (typeof raw !== 'string') {
		return '';
	}
	const trimmed = raw.trim().toLowerCase();
	if (trimmed === '' || trimmed === 'default') {
		return '';
	}
	return trimmed;
};

export const resolveChatCompletionsUrl = (apiUrl: string): string => {
	const trimmed = apiUrl.trim().replace(/\/+$/, '');
	const base = trimmed || 'https://api.openai.com/v1';
	return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
};

export const resolveModelsUrl = (apiUrl: string): string => {
	const trimmed = apiUrl.trim().replace(/\/+$/, '');
	const base = trimmed || 'https://api.openai.com/v1';
	if (base.endsWith('/chat/completions')) {
		return `${base.slice(0, -'/chat/completions'.length)}/models`;
	}
	return base.endsWith('/models') ? base : `${base}/models`;
};

const parseThinkingLevelArray = (candidate: unknown): string[] => {
	if (!Array.isArray(candidate)) {
		return [];
	}

	const levels: string[] = [];
	const seen = new Set<string>();

	for (const entry of candidate) {
		let rawLevel: unknown;
		if (typeof entry === 'string') {
			rawLevel = entry;
		} else if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
			const record = entry as Record<string, unknown>;
			rawLevel =
				record['id'] ?? record['effort'] ?? record['level'] ?? record['name'];
		}

		if (typeof rawLevel === 'string') {
			const normalized = rawLevel.trim().toLowerCase();
			if (normalized !== '' && !seen.has(normalized)) {
				seen.add(normalized);
				levels.push(normalized);
			}
		}
	}

	return levels;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

export const extractThinkingLevelsFromModelRecord = (
	record: Record<string, unknown>,
): string[] => {
	const nestedReasoning = isPlainObject(record['reasoning'])
		? record['reasoning']
		: undefined;
	const nestedCapabilities = isPlainObject(record['capabilities'])
		? record['capabilities']
		: undefined;
	const nestedMetadata = isPlainObject(record['metadata'])
		? record['metadata']
		: undefined;

	const explicitCandidates: unknown[] = [
		record['thinking_levels'],
		record['thinkingLevels'],
		record['reasoning_efforts'],
		record['reasoningEfforts'],
		record['supported_reasoning_efforts'],
		record['supportedReasoningEfforts'],
		nestedReasoning?.['supported_efforts'],
		nestedReasoning?.['supportedEfforts'],
		nestedReasoning?.['efforts'],
		nestedReasoning?.['levels'],
		nestedCapabilities?.['thinking_levels'],
		nestedCapabilities?.['thinkingLevels'],
		nestedCapabilities?.['reasoning_efforts'],
		nestedCapabilities?.['reasoningEfforts'],
		nestedMetadata?.['thinking_levels'],
		nestedMetadata?.['thinkingLevels'],
		nestedMetadata?.['reasoning_efforts'],
		nestedMetadata?.['reasoningEfforts'],
	];

	const combined: string[] = [];
	const seen = new Set<string>();
	for (const candidate of explicitCandidates) {
		for (const level of parseThinkingLevelArray(candidate)) {
			if (!seen.has(level)) {
				seen.add(level);
				combined.push(level);
			}
		}
	}

	if (combined.length > 0) {
		return combined;
	}

	const supportedParamsRaw =
		record['supported_parameters'] ?? record['supportedParameters'];
	if (Array.isArray(supportedParamsRaw)) {
		const hasReasoningParam = supportedParamsRaw.some(
			(param) =>
				typeof param === 'string' &&
				['reasoning', 'reasoning_effort', 'thinking'].includes(
					param.trim().toLowerCase(),
				),
		);
		if (hasReasoningParam) {
			return [...DEFAULT_THINKING_LEVELS];
		}
	}

	const supportsReasoningFlag =
		record['reasoning'] === true ||
		record['thinking'] === true ||
		nestedCapabilities?.['reasoning'] === true ||
		nestedCapabilities?.['thinking'] === true ||
		nestedCapabilities?.['reasoning_effort'] === true;

	if (supportsReasoningFlag) {
		return [...DEFAULT_THINKING_LEVELS];
	}

	return [];
};

const parseResponseErrorDetail = async (response: Response): Promise<string> => {
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
	return errorDetail;
};

export const fetchEndpointMetadata = async ({
	apiUrl,
	apiKey = '',
	model = '',
	fetchImpl = globalThis.fetch,
}: {
	apiUrl: string;
	apiKey?: string;
	model?: string;
	fetchImpl?: typeof fetch;
}): Promise<EndpointMetadataResult> => {
	const modelsUrl = resolveModelsUrl(apiUrl);
	const headers: Record<string, string> = {
		Accept: 'application/json',
	};
	const trimmedKey = apiKey.trim();
	if (trimmedKey !== '') {
		headers['Authorization'] = `Bearer ${trimmedKey}`;
	}

	const response = await fetchImpl(modelsUrl, {
		method: 'GET',
		headers,
	});

	if (!response.ok) {
		const detail = await parseResponseErrorDetail(response);
		throw new Error(`Failed to fetch models (${response.status}): ${detail}`);
	}

	const payload = (await response.json()) as unknown;
	let rawEntries: unknown[] = [];
	if (Array.isArray(payload)) {
		rawEntries = payload;
	} else if (isPlainObject(payload)) {
		if (Array.isArray(payload['data'])) {
			rawEntries = payload['data'];
		} else if (Array.isArray(payload['models'])) {
			rawEntries = payload['models'];
		}
	}

	const modelMap = new Map<string, string[]>();
	const mergeLevels = (existing: string[], incoming: string[]): string[] => {
		const merged = [...existing];
		const seen = new Set(existing);
		for (const level of incoming) {
			if (!seen.has(level)) {
				seen.add(level);
				merged.push(level);
			}
		}
		return merged;
	};

	for (const entry of rawEntries) {
		if (typeof entry === 'string') {
			const id = entry.trim();
			if (id !== '' && !modelMap.has(id)) {
				modelMap.set(id, []);
			}
			continue;
		}

		if (!isPlainObject(entry)) {
			continue;
		}

		const rawId = entry['id'] ?? entry['model'] ?? entry['name'];
		if (typeof rawId !== 'string' || rawId.trim() === '') {
			continue;
		}

		const id = rawId.trim();
		const levels = extractThinkingLevelsFromModelRecord(entry);
		const existing = modelMap.get(id) ?? [];
		modelMap.set(id, mergeLevels(existing, levels));
	}

	const trimmedModel = model.trim();
	if (trimmedModel !== '' && (modelMap.get(trimmedModel)?.length ?? 0) === 0) {
		try {
			const detailResponse = await fetchImpl(
				`${modelsUrl}/${encodeURIComponent(trimmedModel)}`,
				{
					method: 'GET',
					headers,
				},
			);
			if (detailResponse.ok) {
				const detailPayload = (await detailResponse.json()) as unknown;
				if (isPlainObject(detailPayload)) {
					const detailLevels =
						extractThinkingLevelsFromModelRecord(detailPayload);
					if (detailLevels.length > 0) {
						const existing = modelMap.get(trimmedModel) ?? [];
						modelMap.set(trimmedModel, mergeLevels(existing, detailLevels));
					}
				}
			}
		} catch {
			// Best-effort single-model metadata probe; ignore unsupported endpoints
		}
	}

	const models: EndpointModelInfo[] = Array.from(modelMap.entries()).map(
		([id, thinkingLevels]) => ({
			id,
			thinkingLevels,
		}),
	);

	const selectedLevels = trimmedModel !== '' ? modelMap.get(trimmedModel) : undefined;
	let thinkingLevels: string[] = [];
	if (selectedLevels && selectedLevels.length > 0) {
		thinkingLevels = [...selectedLevels];
	} else {
		for (const info of models) {
			thinkingLevels = mergeLevels(thinkingLevels, info.thinkingLevels);
		}
	}

	return {
		models,
		thinkingLevels,
	};
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
		thinkingLevel: normalizeThinkingLevel(config.thinkingLevel),
	};

	const candidates: ResolvedLLMEndpoint[] = [primary];
	const seen = new Set<string>([
		`${primary.apiUrl}\0${primary.apiKey}\0${primary.model}\0${primary.temperature}\0${primary.thinkingLevel}`,
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

		const rawThinking =
			typeof fallback.thinkingLevel === 'string'
				? fallback.thinkingLevel.trim().toLowerCase()
				: '';
		const resolvedThinkingLevel =
			rawThinking === ''
				? primary.thinkingLevel
				: rawThinking === 'default'
					? ''
					: rawThinking;

		const dedupeKey = `${resolvedUrl}\0${resolvedKey}\0${resolvedModel}\0${resolvedTemp}\0${resolvedThinkingLevel}`;
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
			thinkingLevel: resolvedThinkingLevel,
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

		const requestBody: Record<string, unknown> = {
			model: endpoint.model,
			messages,
			temperature: endpoint.temperature,
		};
		if (endpoint.thinkingLevel !== '') {
			requestBody['reasoning_effort'] = endpoint.thinkingLevel;
		}

		const response = await fetch(endpoint.apiUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorDetail = await parseResponseErrorDetail(response);
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

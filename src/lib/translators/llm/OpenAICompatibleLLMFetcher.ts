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

export const normalizeApiKey = (raw: string): string =>
	raw
		.replace(/[\r\n]+/g, '')
		.trim()
		.replace(/^bearer\s+/i, '')
		.trim();

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
	const trimmed = apiUrl.trim();
	const base = trimmed || 'https://api.openai.com/v1';

	try {
		const parsed = new URL(base);
		const cleanPath = parsed.pathname.replace(/\/+$/, '');
		parsed.pathname = cleanPath.endsWith('/chat/completions')
			? cleanPath
			: `${cleanPath}/chat/completions`;
		return parsed.toString();
	} catch {
		const fallbackBase = base.replace(/\/+$/, '');
		return fallbackBase.endsWith('/chat/completions')
			? fallbackBase
			: `${fallbackBase}/chat/completions`;
	}
};

export const resolveModelsUrl = (apiUrl: string): string => {
	const trimmed = apiUrl.trim();
	const base = trimmed || 'https://api.openai.com/v1';

	try {
		const parsed = new URL(base);
		const cleanPath = parsed.pathname.replace(/\/+$/, '');
		if (cleanPath.endsWith('/chat/completions')) {
			parsed.pathname = `${cleanPath.slice(0, -'/chat/completions'.length)}/models`;
		} else {
			parsed.pathname = cleanPath.endsWith('/models')
				? cleanPath
				: `${cleanPath}/models`;
		}
		return parsed.toString();
	} catch {
		const fallbackBase = base.replace(/\/+$/, '');
		if (fallbackBase.endsWith('/chat/completions')) {
			return `${fallbackBase.slice(0, -'/chat/completions'.length)}/models`;
		}
		return fallbackBase.endsWith('/models') ? fallbackBase : `${fallbackBase}/models`;
	}
};

const buildModelDetailUrl = (modelsUrl: string, modelId: string): string => {
	const encodedModel = encodeURIComponent(modelId);
	try {
		const parsed = new URL(modelsUrl);
		const cleanPath = parsed.pathname.replace(/\/+$/, '');
		parsed.pathname = `${cleanPath}/${encodedModel}`;
		return parsed.toString();
	} catch {
		return `${modelsUrl.replace(/\/+$/, '')}/${encodedModel}`;
	}
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

type ParsedResponseError = {
	detail: string;
	param?: string;
	code?: string;
};

const extractStructuredError = (payload: unknown): ParsedResponseError | null => {
	if (Array.isArray(payload)) {
		for (const item of payload) {
			const extracted = extractStructuredError(item);
			if (extracted !== null) {
				return extracted;
			}
		}
		return null;
	}

	if (!isPlainObject(payload)) {
		return null;
	}

	const errorField = payload['error'];
	if (typeof errorField === 'string' && errorField.trim() !== '') {
		return { detail: errorField.trim() };
	}

	if (isPlainObject(errorField)) {
		const rawMessage = errorField['message'];
		const rawParam = errorField['param'];
		const rawCode = errorField['code'];
		const param =
			typeof rawParam === 'string' && rawParam.trim() !== ''
				? rawParam.trim()
				: undefined;
		const code =
			typeof rawCode === 'string' && rawCode.trim() !== ''
				? rawCode.trim()
				: undefined;

		let message =
			typeof rawMessage === 'string' && rawMessage.trim() !== ''
				? rawMessage.trim()
				: '';

		// Unwrap nested provider error details (e.g. OpenRouter error.metadata.raw)
		const metadata = errorField['metadata'];
		if (isPlainObject(metadata) && typeof metadata['raw'] === 'string') {
			const rawMeta = metadata['raw'].trim();
			if (rawMeta !== '') {
				let nestedDetail = rawMeta;
				try {
					const parsedMeta = JSON.parse(rawMeta) as unknown;
					const nested = extractStructuredError(parsedMeta);
					if (nested !== null && nested.detail !== '') {
						nestedDetail = nested.detail;
					}
				} catch {
					// Keep raw string when metadata.raw is plain text
				}

				if (nestedDetail !== '' && !message.includes(nestedDetail)) {
					message = message ? `${message} (${nestedDetail})` : nestedDetail;
				}
			}
		}

		if (message === '' && typeof errorField['detail'] === 'string') {
			message = errorField['detail'].trim();
		}

		if (message !== '') {
			const detail =
				param && !message.toLowerCase().includes(param.toLowerCase())
					? `${param}: ${message}`
					: message;
			return { detail, param, code };
		}
	}

	const topMessage = payload['message'];
	if (typeof topMessage === 'string' && topMessage.trim() !== '') {
		return { detail: topMessage.trim() };
	}

	const detailField = payload['detail'];
	if (typeof detailField === 'string' && detailField.trim() !== '') {
		return { detail: detailField.trim() };
	}
	if (Array.isArray(detailField)) {
		const parts: string[] = [];
		let firstParam: string | undefined;
		for (const item of detailField) {
			if (typeof item === 'string' && item.trim() !== '') {
				parts.push(item.trim());
				continue;
			}
			if (!isPlainObject(item)) {
				continue;
			}
			const msg =
				typeof item['msg'] === 'string'
					? item['msg'].trim()
					: typeof item['message'] === 'string'
						? item['message'].trim()
						: '';
			const loc = Array.isArray(item['loc'])
				? item['loc']
						.filter(
							(segment): segment is string | number =>
								typeof segment === 'string' ||
								typeof segment === 'number',
						)
						.map(String)
				: [];
			if (firstParam === undefined && loc.length > 0) {
				firstParam = loc[loc.length - 1];
			}
			if (msg !== '') {
				parts.push(loc.length > 0 ? `${loc.join('.')}: ${msg}` : msg);
			}
		}
		if (parts.length > 0) {
			return {
				detail: parts.join('; '),
				param: firstParam,
			};
		}
	}

	const errorsField = payload['errors'];
	if (Array.isArray(errorsField)) {
		return extractStructuredError(errorsField);
	}

	return null;
};

const parseResponseError = async (response: Response): Promise<ParsedResponseError> => {
	const fallbackDetail = response.statusText?.trim() || 'Bad Request';

	if (typeof response.text === 'function') {
		try {
			const rawText = (await response.text()).trim();
			if (rawText === '') {
				return { detail: fallbackDetail };
			}
			try {
				const parsed = JSON.parse(rawText) as unknown;
				const extracted = extractStructuredError(parsed);
				if (extracted !== null) {
					return extracted;
				}
			} catch {
				// Non-JSON plain-text error body
			}
			const clipped =
				rawText.length > 500 ? `${rawText.slice(0, 500)}...` : rawText;
			return { detail: clipped };
		} catch {
			// Fall through to response.json() if available
		}
	}

	if (typeof response.json === 'function') {
		try {
			const errorBody = (await response.json()) as unknown;
			const extracted = extractStructuredError(errorBody);
			if (extracted !== null) {
				return extracted;
			}
		} catch {
			// Ignore JSON parse error on non-JSON error responses
		}
	}

	return { detail: fallbackDetail };
};

const parseResponseErrorDetail = async (response: Response): Promise<string> => {
	const parsed = await parseResponseError(response);
	return parsed.detail;
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
	const trimmedKey = normalizeApiKey(apiKey);
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
				buildModelDetailUrl(modelsUrl, trimmedModel),
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
		apiKey: normalizeApiKey(config.apiKey),
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
		const rawKey =
			typeof fallback.apiKey === 'string' ? normalizeApiKey(fallback.apiKey) : '';
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

type EndpointCompatibilityProfile = {
	omitTemperature: boolean;
	reasoningEffortOverride?: string;
	mergeSystemIntoUser: boolean;
};

type RequestAttemptState = {
	includeTemperature: boolean;
	reasoningEffort: string;
	mergeSystemIntoUser: boolean;
	triedReasoningEfforts: Set<string>;
};

const TEMPERATURE_ERROR_PATTERN = /\btemperature\b/i;
const SYSTEM_ROLE_ERROR_PATTERN =
	/system\s*(?:role|message|prompt|instruction)|developer\s+instruction|messages\[0\]\.role|roles?\s+must\s+alternate|does\s+not\s+support\s+['"]?system|unsupported[^.\n]*['"]?system|role\b[^.\n]*['"]?system|first\s+message[^.\n]*user|must\s+(?:start|begin)\s+with[^.\n]*user/i;
const REASONING_PARAM_UNSUPPORTED_PATTERN =
	/unsupported\s+parameter[^.\n]*reasoning|unrecognized\s+request\s+argument|extra\s+inputs\s+are\s+not\s+permitted|unknown\s+(?:parameter|field)|does\s+not\s+support\s+(?:parameter\s+)?['"]?reasoning_effort|reasoning_effort[^.\n]*not\s+(?:supported|allowed|recognized)/i;
const REASONING_ERROR_PATTERN =
	/reasoning_effort|reasoning\.effort|thinking_level|thinking(?:_config|_budget|\s+mode|\s+budget|\s+level)?|budget\s+0|unsupported[^.\n]*reasoning|invalid[^.\n]*reasoning|extra\s+inputs\s+are\s+not\s+permitted|unrecognized\s+request\s+argument|unknown\s+(?:parameter|field)/i;
const UNRECOVERABLE_BAD_REQUEST_PATTERN =
	/model_not_found|model\s+['"`]?[^\s'"`]+['"`]?\s+(?:not\s+found|does\s+not\s+exist|is\s+not\s+available|unavailable)|unknown\s+model|invalid\s+model|context_length_exceeded|maximum\s+context\s+length|too\s+many\s+tokens|prompt\s+is\s+too\s+long|input\s+is\s+too\s+long|insufficient_quota|insufficient\s+balance|credit|billing|invalid_api_key|invalid\s+api\s+key|api\s+key\s+not\s+valid|content_filter|content_policy|moderation|safety/i;

const resolveNextReasoningEffort = (
	currentEffort: string,
	detail: string,
	triedEfforts: Set<string>,
): string => {
	if (REASONING_PARAM_UNSUPPORTED_PATTERN.test(detail)) {
		return '';
	}

	const downgradeMap: Record<string, string> = {
		xhigh: 'high',
		minimal: 'low',
	};
	const candidate = downgradeMap[currentEffort];
	if (candidate && !triedEfforts.has(candidate)) {
		return candidate;
	}

	return '';
};

const adaptRequestForBadRequest = (
	state: RequestAttemptState,
	hasSystemPrompt: boolean,
	status: number,
	parsedError: ParsedResponseError,
): { nextState: RequestAttemptState; reason: string } | null => {
	const detail = parsedError.detail;
	const param = parsedError.param?.toLowerCase() ?? '';
	const code = parsedError.code?.toLowerCase() ?? '';
	const combinedText = `${param} ${code} ${detail}`;

	// 1. Temperature rejection (checked before reasoning because errors like
	// "temperature must be 1 when thinking/reasoning_effort is enabled" mention both)
	if (
		state.includeTemperature &&
		(param === 'temperature' || TEMPERATURE_ERROR_PATTERN.test(detail))
	) {
		return {
			nextState: {
				...state,
				includeTemperature: false,
			},
			reason: 'omitting unsupported temperature parameter',
		};
	}

	// 2. System/developer message role rejection
	if (
		hasSystemPrompt &&
		!state.mergeSystemIntoUser &&
		(param.includes('messages') && SYSTEM_ROLE_ERROR_PATTERN.test(detail)
			? true
			: SYSTEM_ROLE_ERROR_PATTERN.test(detail))
	) {
		return {
			nextState: {
				...state,
				mergeSystemIntoUser: true,
			},
			reason: 'merging system prompt into user message',
		};
	}

	// 3. reasoning_effort parameter or value rejection
	if (state.reasoningEffort !== '') {
		const isReasoningParamError =
			param === 'reasoning_effort' ||
			param === 'reasoning' ||
			param === 'thinking_level' ||
			REASONING_ERROR_PATTERN.test(detail) ||
			(detail.toLowerCase().includes(`'${state.reasoningEffort}'`) &&
				/(?:invalid|unsupported|supported|valid|allowed)\s+value/i.test(detail));

		if (isReasoningParamError) {
			const nextEffort = resolveNextReasoningEffort(
				state.reasoningEffort,
				detail,
				state.triedReasoningEfforts,
			);
			const nextTried = new Set(state.triedReasoningEfforts);
			nextTried.add(nextEffort);
			return {
				nextState: {
					...state,
					reasoningEffort: nextEffort,
					triedReasoningEfforts: nextTried,
				},
				reason: nextEffort
					? `downgrading reasoning_effort from "${state.reasoningEffort}" to "${nextEffort}"`
					: `omitting unsupported reasoning_effort "${state.reasoningEffort}"`,
			};
		}
	}

	// 4. Do not retry unrecoverable 400/422 errors (missing model, auth, quota, context length, safety)
	if (UNRECOVERABLE_BAD_REQUEST_PATTERN.test(combinedText)) {
		return null;
	}

	// 5. Generic / opaque HTTP 400 fallback: progressively drop optional fields
	if (status === 400) {
		if (state.reasoningEffort !== '') {
			const nextTried = new Set(state.triedReasoningEfforts);
			nextTried.add('');
			return {
				nextState: {
					...state,
					reasoningEffort: '',
					triedReasoningEfforts: nextTried,
				},
				reason: `omitting reasoning_effort "${state.reasoningEffort}" after generic HTTP 400`,
			};
		}

		if (state.includeTemperature) {
			return {
				nextState: {
					...state,
					includeTemperature: false,
				},
				reason: 'omitting temperature after generic HTTP 400',
			};
		}

		if (hasSystemPrompt && !state.mergeSystemIntoUser) {
			return {
				nextState: {
					...state,
					mergeSystemIntoUser: true,
				},
				reason: 'merging system prompt into user message after generic HTTP 400',
			};
		}
	}

	return null;
};

const extractChoiceContent = (content: unknown): string | null => {
	if (typeof content === 'string') {
		return content;
	}

	if (Array.isArray(content)) {
		const textParts = content
			.map((part) => {
				if (typeof part === 'string') {
					return part;
				}
				if (isPlainObject(part) && typeof part['text'] === 'string') {
					return part['text'];
				}
				return null;
			})
			.filter((part): part is string => part !== null);

		if (textParts.length > 0) {
			return textParts.join('');
		}
	}

	return null;
};

const MAX_BAD_REQUEST_ADAPTATIONS = 4;

export class OpenAICompatibleLLMFetcher implements LLMFetcher {
	private readonly config: OpenAICompatibleFetcherConfig;
	private readonly compatibilityCache = new Map<string, EndpointCompatibilityProfile>();

	constructor(config: OpenAICompatibleFetcherConfig) {
		this.config = config;
	}

	public getLengthLimit(): number {
		return 5000;
	}

	public getRequestsTimeout(): number {
		return 500;
	}

	private getCompatibilityCacheKey(endpoint: ResolvedLLMEndpoint): string {
		return `${endpoint.apiUrl}\0${endpoint.model}\0${endpoint.temperature}\0${endpoint.thinkingLevel}`;
	}

	private buildMessages(
		systemPrompt: string,
		userPrompt: string,
		mergeSystemIntoUser: boolean,
	): { role: 'system' | 'user'; content: string }[] {
		if (!systemPrompt) {
			return [{ role: 'user', content: userPrompt }];
		}

		if (mergeSystemIntoUser) {
			return [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }];
		}

		return [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		];
	}

	private async fetchFromEndpoint(
		endpoint: ResolvedLLMEndpoint,
		systemPrompt: string,
		userPrompt: string,
	): Promise<string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (endpoint.apiKey !== '') {
			headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
		}

		const cacheKey = this.getCompatibilityCacheKey(endpoint);
		const cachedProfile = this.compatibilityCache.get(cacheKey);
		const initialReasoningEffort =
			cachedProfile?.reasoningEffortOverride !== undefined
				? cachedProfile.reasoningEffortOverride
				: endpoint.thinkingLevel;

		let attemptState: RequestAttemptState = {
			includeTemperature: !(cachedProfile?.omitTemperature ?? false),
			reasoningEffort: initialReasoningEffort,
			mergeSystemIntoUser: cachedProfile?.mergeSystemIntoUser ?? false,
			triedReasoningEfforts: new Set([initialReasoningEffort]),
		};

		const hasSystemPrompt = systemPrompt !== '';
		let adaptations = 0;

		while (true) {
			const messages = this.buildMessages(
				systemPrompt,
				userPrompt,
				attemptState.mergeSystemIntoUser,
			);
			const requestBody: Record<string, unknown> = {
				model: endpoint.model,
				messages,
			};
			if (attemptState.includeTemperature) {
				requestBody['temperature'] = endpoint.temperature;
			}
			if (attemptState.reasoningEffort !== '') {
				requestBody['reasoning_effort'] = attemptState.reasoningEffort;
			}

			const response = await fetch(endpoint.apiUrl, {
				method: 'POST',
				headers,
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const parsedError = await parseResponseError(response);
				if (
					(response.status === 400 || response.status === 422) &&
					adaptations < MAX_BAD_REQUEST_ADAPTATIONS
				) {
					const adapted = adaptRequestForBadRequest(
						attemptState,
						hasSystemPrompt,
						response.status,
						parsedError,
					);
					if (adapted !== null) {
						adaptations++;
						console.warn(
							`[LLMTranslator] ${endpoint.label} (${endpoint.model} @ ${endpoint.apiUrl}) returned HTTP ${response.status} (${parsedError.detail}). Retrying by ${adapted.reason}.`,
						);
						attemptState = adapted.nextState;
						continue;
					}
				}

				throw new Error(
					`LLM API request failed with status ${response.status}: ${parsedError.detail}`,
				);
			}

			if (adaptations > 0) {
				this.compatibilityCache.set(cacheKey, {
					omitTemperature: !attemptState.includeTemperature,
					reasoningEffortOverride:
						attemptState.reasoningEffort !== endpoint.thinkingLevel
							? attemptState.reasoningEffort
							: undefined,
					mergeSystemIntoUser: attemptState.mergeSystemIntoUser,
				});
			}

			const data = (await response.json()) as {
				choices?: { message?: { content?: unknown } }[];
			};
			const content = extractChoiceContent(data?.choices?.[0]?.message?.content);
			if (content === null) {
				throw new Error(
					'LLM API response did not contain choices[0].message.content',
				);
			}

			return cleanLLMJsonResponse(content);
		}
	}

	public async fetch(prompt: string): Promise<string> {
		const { systemPrompt, userPrompt, expectedLength } = decodePromptEnvelope(prompt);

		const candidates = resolveEndpointCandidates(this.config);
		const hasFallbacks = candidates.length > 1;
		const errors: { endpoint: ResolvedLLMEndpoint; error: unknown }[] = [];

		for (let i = 0; i < candidates.length; i++) {
			const candidate = candidates[i];
			try {
				const cleaned = await this.fetchFromEndpoint(
					candidate,
					systemPrompt,
					userPrompt,
				);

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

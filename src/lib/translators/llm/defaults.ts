import type {
	LLMFallbackEndpointConfig,
	LLMTranslatorConfig,
} from '../../../types/runtime';

export const DEFAULT_LLM_SYSTEM_PROMPT =
	'You are a professional translator. Translate accurately and naturally while preserving original meaning, tone, punctuation, and formatting. Never add explanations, notes, or commentary.';

export const DEFAULT_LLM_USER_PROMPT =
	'Translate the following JSON array of texts from {{from}} to {{to}}.\nIf the source language is "auto", detect the source language automatically.\nReturn ONLY a valid JSON array of translated strings with the exact same length and order.\n\n{{texts}}';

export const defaultLLMFallbackEndpoint: LLMFallbackEndpointConfig = {
	apiUrl: '',
	apiKey: '',
	model: '',
};

export const defaultLLMTranslatorConfig: LLMTranslatorConfig = {
	apiUrl: 'https://api.openai.com/v1',
	apiKey: '',
	model: 'gpt-4o-mini',
	temperature: 0,
	systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
	customPrompt: DEFAULT_LLM_USER_PROMPT,
	fallbacks: [],
};

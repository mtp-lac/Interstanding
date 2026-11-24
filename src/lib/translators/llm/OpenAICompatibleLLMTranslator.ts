import { getLanguageCodesISO639 } from 'anylang/languages';
import { LLMTranslator } from 'anylang/translators/LLMTranslators/LLMTranslator';

import type { LLMTranslatorConfig } from '../../../types/runtime';

import { defaultLLMTranslatorConfig } from './defaults';
import {
	encodePromptEnvelope,
	OpenAICompatibleLLMFetcher,
} from './OpenAICompatibleLLMFetcher';
import { buildLLMPromptMessages } from './promptBuilder';

export class OpenAICompatibleLLMTranslator extends LLMTranslator {
	constructor(config: Partial<LLMTranslatorConfig> = {}) {
		const mergedConfig: LLMTranslatorConfig = {
			...defaultLLMTranslatorConfig,
			...config,
		};

		const fetcher = new OpenAICompatibleLLMFetcher({
			apiUrl: mergedConfig.apiUrl,
			apiKey: mergedConfig.apiKey,
			model: mergedConfig.model,
			temperature: mergedConfig.temperature,
		});

		super(fetcher, {
			getPrompt: (texts, from, to) =>
				encodePromptEnvelope(
					buildLLMPromptMessages(mergedConfig, texts, from, to),
				),
		});
	}

	public static readonly translatorName = 'LLM (OpenAI-Compatible)';
	public static isRequiredKey = () => false;
	public static isSupportedAutoFrom = () => true;
	public static getSupportedLanguages = (): string[] => getLanguageCodesISO639('v1');
}

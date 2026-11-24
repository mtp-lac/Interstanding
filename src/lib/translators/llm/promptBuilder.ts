import type { LLMTranslatorConfig } from '../../../types/runtime';

import { DEFAULT_LLM_USER_PROMPT } from './defaults';

export type PromptTemplateParams = {
	texts: string[];
	from: string;
	to: string;
};

export type LLMPromptMessages = {
	systemPrompt: string;
	userPrompt: string;
};

const getLanguageDisplayName = (code: string): string => {
	if (code === 'auto') {
		return 'auto';
	}

	try {
		const langFormatter = new Intl.DisplayNames(['en'], { type: 'language' });
		return langFormatter.of(code) ?? code;
	} catch {
		return code;
	}
};

export const renderPromptTemplate = (
	template: string,
	{ texts, from, to }: PromptTemplateParams,
): string => {
	const originLang = getLanguageDisplayName(from);
	const targetLang = getLanguageDisplayName(to);
	const serializedTexts = JSON.stringify(texts);

	const replacements: Record<string, string> = {
		from: originLang,
		to: targetLang,
		fromCode: from,
		toCode: to,
		texts: serializedTexts,
	};

	return template.replace(
		/\{\{(from|to|fromCode|toCode|texts)\}\}/g,
		(_, token: string) => replacements[token] ?? '',
	);
};

export const buildLLMPromptMessages = (
	config: Pick<LLMTranslatorConfig, 'systemPrompt' | 'customPrompt'>,
	texts: string[],
	from: string,
	to: string,
): LLMPromptMessages => {
	const params: PromptTemplateParams = { texts, from, to };
	const rawSystemPrompt = config.systemPrompt.trim();
	const systemPrompt = rawSystemPrompt
		? renderPromptTemplate(rawSystemPrompt, params).trim()
		: '';

	const rawCustomPrompt = config.customPrompt.trim();
	if (!rawCustomPrompt) {
		return {
			systemPrompt,
			userPrompt: renderPromptTemplate(DEFAULT_LLM_USER_PROMPT, params),
		};
	}

	let userPrompt = renderPromptTemplate(rawCustomPrompt, params);
	if (!rawCustomPrompt.includes('{{texts}}')) {
		const originLang = getLanguageDisplayName(from);
		const targetLang = getLanguageDisplayName(to);
		userPrompt = `${userPrompt}\n\nTranslate from ${originLang} to ${targetLang}. Return ONLY a valid JSON array of translated strings with the exact same length (${texts.length}) and order:\n${JSON.stringify(texts)}`;
	}

	return {
		systemPrompt,
		userPrompt,
	};
};

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

const sanitizeUtf16 = (value: string): string => {
	const maybeWellFormed = value as string & { toWellFormed?: () => string };
	if (typeof maybeWellFormed.toWellFormed === 'function') {
		return maybeWellFormed.toWellFormed();
	}

	let result = '';
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
			if (next >= 0xdc00 && next <= 0xdfff) {
				result += value[i] + value[i + 1];
				i++;
			} else {
				result += '\uFFFD';
			}
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			result += '\uFFFD';
		} else {
			result += value[i];
		}
	}
	return result;
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
	const sanitizedTexts = texts.map(sanitizeUtf16);
	const serializedTexts = JSON.stringify(sanitizedTexts);

	const replacements: Record<string, string> = {
		from: originLang,
		to: targetLang,
		fromCode: from,
		toCode: to,
		texts: serializedTexts,
	};

	return sanitizeUtf16(
		template.replace(
			/\{\{(from|to|fromCode|toCode|texts)\}\}/g,
			(_, token: string) => replacements[token] ?? '',
		),
	);
};

export const buildLLMPromptMessages = (
	config: Pick<LLMTranslatorConfig, 'systemPrompt' | 'customPrompt'>,
	texts: string[],
	from: string,
	to: string,
): LLMPromptMessages => {
	const sanitizedTexts = texts.map(sanitizeUtf16);
	const params: PromptTemplateParams = { texts: sanitizedTexts, from, to };
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
		userPrompt = `${userPrompt}\n\nTranslate from ${originLang} to ${targetLang}. Return ONLY a valid JSON array of translated strings with the exact same length (${sanitizedTexts.length}) and order:\n${JSON.stringify(sanitizedTexts)}`;
	}

	return {
		systemPrompt,
		userPrompt,
	};
};

import {
	buildLLMPromptMessages,
	cleanLLMJsonResponse,
	DEFAULT_LLM_SYSTEM_PROMPT,
	DEFAULT_LLM_USER_PROMPT,
	DEFAULT_THINKING_LEVELS,
	extractThinkingLevelsFromModelRecord,
	fetchEndpointMetadata,
	OpenAICompatibleLLMTranslator,
	resolveChatCompletionsUrl,
	resolveEndpointCandidates,
	resolveModelsUrl,
	validateLLMJsonOutput,
} from '../index';

describe('resolveChatCompletionsUrl', () => {
	test('appends /chat/completions to OpenAI base URL', () => {
		expect(resolveChatCompletionsUrl('https://api.openai.com/v1')).toBe(
			'https://api.openai.com/v1/chat/completions',
		);
	});

	test('strips trailing slashes before appending /chat/completions', () => {
		expect(resolveChatCompletionsUrl('http://localhost:11434/v1///')).toBe(
			'http://localhost:11434/v1/chat/completions',
		);
	});

	test('keeps URL intact when it already ends with /chat/completions', () => {
		expect(
			resolveChatCompletionsUrl('https://openrouter.ai/api/v1/chat/completions/'),
		).toBe('https://openrouter.ai/api/v1/chat/completions');
	});

	test('defaults to OpenAI URL when blank', () => {
		expect(resolveChatCompletionsUrl('   ')).toBe(
			'https://api.openai.com/v1/chat/completions',
		);
	});
});

describe('resolveModelsUrl', () => {
	test('appends /models to base URL and strips /chat/completions if present', () => {
		expect(resolveModelsUrl('https://api.openai.com/v1')).toBe(
			'https://api.openai.com/v1/models',
		);
		expect(resolveModelsUrl('https://openrouter.ai/api/v1/chat/completions/')).toBe(
			'https://openrouter.ai/api/v1/models',
		);
		expect(resolveModelsUrl('http://localhost:11434/v1/models/')).toBe(
			'http://localhost:11434/v1/models',
		);
		expect(resolveModelsUrl('')).toBe('https://api.openai.com/v1/models');
	});
});

describe('extractThinkingLevelsFromModelRecord and fetchEndpointMetadata', () => {
	test('extracts explicit thinking_levels and supported_reasoning_efforts arrays', () => {
		expect(
			extractThinkingLevelsFromModelRecord({
				id: 'o3-mini',
				supported_reasoning_efforts: ['low', 'Medium', 'HIGH', 'low'],
			}),
		).toEqual(['low', 'medium', 'high']);

		expect(
			extractThinkingLevelsFromModelRecord({
				id: 'qwen3',
				capabilities: {
					thinking_levels: ['none', 'low', 'high'],
				},
			}),
		).toEqual(['none', 'low', 'high']);
	});

	test('maps reasoning parameter/capability flags to default thinking levels', () => {
		expect(
			extractThinkingLevelsFromModelRecord({
				id: 'deepseek/deepseek-r1',
				supported_parameters: ['temperature', 'reasoning'],
			}),
		).toEqual([...DEFAULT_THINKING_LEVELS]);
	});

	test('fetches models and thinking levels from OpenAI-style /models response', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{
						id: 'o3-mini',
						supported_reasoning_efforts: ['low', 'medium', 'high'],
					},
					{
						id: 'gpt-4o-mini',
					},
				],
			}),
		});

		const result = await fetchEndpointMetadata({
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-test',
			model: 'o3-mini',
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: 'Bearer sk-test',
			},
		});
		expect(result.models).toEqual([
			{ id: 'o3-mini', thinkingLevels: ['low', 'medium', 'high'] },
			{ id: 'gpt-4o-mini', thinkingLevels: [] },
		]);
		expect(result.thinkingLevels).toEqual(['low', 'medium', 'high']);
	});

	test('fetches models from Ollama-style { models } response and probes selected model when needed', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					models: [{ name: 'qwen3:8b' }, { name: 'llama3.2' }],
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					name: 'qwen3:8b',
					thinking_levels: ['none', 'low', 'medium', 'high'],
				}),
			});

		const result = await fetchEndpointMetadata({
			apiUrl: 'http://localhost:11434/v1',
			model: 'qwen3:8b',
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(result.models).toEqual([
			{ id: 'qwen3:8b', thinkingLevels: ['none', 'low', 'medium', 'high'] },
			{ id: 'llama3.2', thinkingLevels: [] },
		]);
		expect(result.thinkingLevels).toEqual(['none', 'low', 'medium', 'high']);
	});
});

describe('cleanLLMJsonResponse', () => {
	test('returns plain JSON array unchanged', () => {
		expect(cleanLLMJsonResponse('["Hola", "Mundo"]')).toBe('["Hola", "Mundo"]');
	});

	test('unwraps markdown json code fences', () => {
		expect(cleanLLMJsonResponse('```json\n["Bonjour", "Monde"]\n```')).toBe(
			'["Bonjour", "Monde"]',
		);
	});

	test('strips <think> reasoning blocks and surrounding prose', () => {
		const raw =
			'<think>Thinking about translation...</think>\nHere is the translation:\n```json\n["Hallo"]\n```\nHope that helps!';
		expect(cleanLLMJsonResponse(raw)).toBe('["Hallo"]');
	});
});

describe('validateLLMJsonOutput', () => {
	test('accepts valid string array matching expected length', () => {
		expect(validateLLMJsonOutput('["Hola", "Mundo"]', 2)).toBeNull();
	});

	test('rejects invalid JSON', () => {
		expect(validateLLMJsonOutput('not valid json', 1)).toContain('not valid JSON');
	});

	test('rejects non-array JSON and non-string items', () => {
		expect(validateLLMJsonOutput('{"text":"Hola"}', 1)).toContain('not an array');
		expect(validateLLMJsonOutput('["Hola", 123]', 2)).toContain(
			'non-string elements',
		);
	});

	test('rejects mismatched item count', () => {
		expect(validateLLMJsonOutput('["Hola"]', 2)).toContain(
			'Expected 2 translated item(s), received 1',
		);
	});
});

describe('resolveEndpointCandidates', () => {
	test('inherits primary apiUrl and apiKey for model-only fallback, but not apiKey for custom apiUrl', () => {
		const candidates = resolveEndpointCandidates({
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-primary',
			model: 'gpt-4o-mini',
			temperature: 0.1,
			fallbacks: [
				{ apiUrl: '  ', apiKey: '', model: '' },
				{ apiUrl: '', apiKey: '', model: 'gpt-4.1-mini' },
				{ apiUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5' },
				{
					apiUrl: 'https://api.openai.com/v1',
					apiKey: 'sk-primary',
					model: 'gpt-4o-mini',
				},
			],
		});

		expect(candidates).toEqual([
			{
				label: 'primary',
				apiUrl: 'https://api.openai.com/v1/chat/completions',
				apiKey: 'sk-primary',
				model: 'gpt-4o-mini',
				temperature: 0.1,
				thinkingLevel: '',
			},
			{
				label: 'fallback #2',
				apiUrl: 'https://api.openai.com/v1/chat/completions',
				apiKey: 'sk-primary',
				model: 'gpt-4.1-mini',
				temperature: 0.1,
				thinkingLevel: '',
			},
			{
				label: 'fallback #3',
				apiUrl: 'http://localhost:11434/v1/chat/completions',
				apiKey: '',
				model: 'qwen2.5',
				temperature: 0.1,
				thinkingLevel: '',
			},
		]);
	});

	test('inherits primary thinkingLevel unless overridden or reset to default', () => {
		const candidates = resolveEndpointCandidates({
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-primary',
			model: 'o3-mini',
			temperature: 0,
			thinkingLevel: 'high',
			fallbacks: [
				{ apiUrl: '', apiKey: '', model: 'o4-mini' },
				{ apiUrl: '', apiKey: '', model: 'o4-mini', thinkingLevel: 'low' },
				{
					apiUrl: '',
					apiKey: '',
					model: 'gpt-4o-mini',
					thinkingLevel: 'default',
				},
			],
		});

		expect(candidates.map((c) => [c.model, c.thinkingLevel])).toEqual([
			['o3-mini', 'high'],
			['o4-mini', 'high'],
			['o4-mini', 'low'],
			['gpt-4o-mini', ''],
		]);
	});
});

describe('buildLLMPromptMessages', () => {
	test('renders default prompt template with language names and JSON payload', () => {
		const { systemPrompt, userPrompt } = buildLLMPromptMessages(
			{
				systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
				customPrompt: DEFAULT_LLM_USER_PROMPT,
			},
			['Hello', 'World'],
			'en',
			'es',
		);

		expect(systemPrompt).toBe(DEFAULT_LLM_SYSTEM_PROMPT);
		expect(userPrompt).toContain('from English to Spanish');
		expect(userPrompt).toContain('["Hello","World"]');
	});

	test('supports all template placeholders including codes without double-substitution', () => {
		const { systemPrompt, userPrompt } = buildLLMPromptMessages(
			{
				systemPrompt: 'Translate {{fromCode}} -> {{toCode}} ({{from}} to {{to}})',
				customPrompt: 'Direction {{from}} -> {{to}}: {{texts}}',
			},
			['Keep {{to}} literal'],
			'auto',
			'ja',
		);

		expect(systemPrompt).toBe('Translate auto -> ja (auto to Japanese)');
		expect(userPrompt).toBe('Direction auto -> Japanese: ["Keep {{to}} literal"]');
	});

	test('appends JSON array instructions when customPrompt omits {{texts}}', () => {
		const { userPrompt } = buildLLMPromptMessages(
			{
				systemPrompt: '',
				customPrompt: 'Use a casual conversational tone.',
			},
			['Good morning'],
			'en',
			'fr',
		);

		expect(userPrompt).toContain('Use a casual conversational tone.');
		expect(userPrompt).toContain('Translate from English to French.');
		expect(userPrompt).toContain('same length (1)');
		expect(userPrompt).toContain('["Good morning"]');
	});
});

describe('OpenAICompatibleLLMTranslator', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	test('sends authenticated request with system and custom prompts', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: '```json\n["Hola", "Adiós"]\n```' } }],
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const translator = new OpenAICompatibleLLMTranslator({
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-test-123',
			model: 'gpt-4o-mini',
			temperature: 0.2,
			systemPrompt: 'Act as a technical translator for {{to}}.',
			customPrompt: 'Translate from {{from}} to {{to}}: {{texts}}',
		});

		const result = await translator.translateBatch(['Hello', 'Goodbye'], 'en', 'es');
		expect(result).toEqual(['Hola', 'Adiós']);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://api.openai.com/v1/chat/completions');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			'Content-Type': 'application/json',
			Authorization: 'Bearer sk-test-123',
		});

		const body = JSON.parse(init.body as string);
		expect(body).toEqual({
			model: 'gpt-4o-mini',
			temperature: 0.2,
			messages: [
				{ role: 'system', content: 'Act as a technical translator for Spanish.' },
				{
					role: 'user',
					content: 'Translate from English to Spanish: ["Hello","Goodbye"]',
				},
			],
		});
	});

	test('omits Authorization header when apiKey is empty (e.g. Ollama)', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: '["Привет"]' } }],
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const translator = new OpenAICompatibleLLMTranslator({
			apiUrl: 'http://localhost:11434/v1',
			apiKey: '   ',
			model: 'translategemma',
		});

		const translated = await translator.translate('Hello', 'en', 'ru');
		expect(translated).toBe('Привет');

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('http://localhost:11434/v1/chat/completions');
		expect(init.headers).toEqual({
			'Content-Type': 'application/json',
		});
	});

	test('retries when LLM returns malformed JSON on first attempt', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: 'not valid json' } }],
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: '["Bonjour"]' } }],
				}),
			});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const translator = new OpenAICompatibleLLMTranslator({
			apiKey: 'sk-test',
		});

		const translated = await translator.translate('Hello', 'en', 'fr');
		expect(translated).toBe('Bonjour');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('falls back to secondary endpoint when primary returns HTTP error', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 429,
				statusText: 'Too Many Requests',
				json: async () => ({ error: { message: 'Rate limit exceeded' } }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: '["Xin chào"]' } }],
				}),
			});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const translator = new OpenAICompatibleLLMTranslator({
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-primary',
			model: 'gpt-4o-mini',
			fallbacks: [
				{
					apiUrl: 'https://openrouter.ai/api/v1',
					apiKey: 'sk-or-backup',
					model: 'google/gemini-2.5-flash',
				},
			],
		});

		const translated = await translator.translate('Hello', 'en', 'vi');
		expect(translated).toBe('Xin chào');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(warnSpy).toHaveBeenCalledTimes(1);

		const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(secondUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(secondInit.headers).toEqual({
			'Content-Type': 'application/json',
			Authorization: 'Bearer sk-or-backup',
		});
		expect(JSON.parse(secondInit.body as string).model).toBe(
			'google/gemini-2.5-flash',
		);
	});

	test('falls back when primary model returns malformed JSON or wrong array length', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: '["Only one"]' } }],
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: 'Sorry, I cannot translate.' } }],
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: '["Hola", "Mundo"]' } }],
				}),
			});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const translator = new OpenAICompatibleLLMTranslator({
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-primary',
			model: 'gpt-4o-mini',
			fallbacks: [
				{ apiUrl: '', apiKey: '', model: 'gpt-4.1-mini' },
				{ apiUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5' },
			],
		});

		const translated = await translator.translateBatch(
			['Hello', 'World'],
			'en',
			'es',
		);
		expect(translated).toEqual(['Hola', 'Mundo']);
		expect(fetchMock).toHaveBeenCalledTimes(3);

		const [url1, init1] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(url1).toBe('https://api.openai.com/v1/chat/completions');
		expect(init1.headers).toEqual({
			'Content-Type': 'application/json',
			Authorization: 'Bearer sk-primary',
		});
		expect(JSON.parse(init1.body as string).model).toBe('gpt-4.1-mini');

		const [url2, init2] = fetchMock.mock.calls[2] as [string, RequestInit];
		expect(url2).toBe('http://localhost:11434/v1/chat/completions');
		expect(init2.headers).toEqual({
			'Content-Type': 'application/json',
		});
		expect(JSON.parse(init2.body as string).model).toBe('qwen2.5');
	});

	test('throws aggregated error when all configured endpoints fail', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('Network timeout'))
			.mockResolvedValueOnce({
				ok: false,
				status: 503,
				statusText: 'Service Unavailable',
				json: async () => ({ message: 'Model overloaded' }),
			});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const translator = new OpenAICompatibleLLMTranslator({
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-primary',
			model: 'gpt-4o-mini',
			fallbacks: [
				{
					apiUrl: 'https://openrouter.ai/api/v1',
					apiKey: 'sk-backup',
					model: 'deepseek/deepseek-chat',
				},
			],
		});

		await expect(translator.translate('Hello', 'en', 'es')).rejects.toThrow(
			/All 2 LLM endpoints failed/,
		);
	});

	test('sends reasoning_effort when thinkingLevel is configured and omits when default', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				json: async () => ({ error: { message: 'Temporary error' } }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: '["Hola"]' } }],
				}),
			});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const translator = new OpenAICompatibleLLMTranslator({
			apiUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-primary',
			model: 'o3-mini',
			thinkingLevel: 'medium',
			fallbacks: [
				{
					apiUrl: '',
					apiKey: '',
					model: 'gpt-4o-mini',
					thinkingLevel: 'default',
				},
			],
		});

		const result = await translator.translate('Hello', 'en', 'es');
		expect(result).toBe('Hola');

		const firstBody = JSON.parse(
			(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
		);
		expect(firstBody.reasoning_effort).toBe('medium');

		const secondBody = JSON.parse(
			(fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
		);
		expect(secondBody.reasoning_effort).toBeUndefined();
	});
});

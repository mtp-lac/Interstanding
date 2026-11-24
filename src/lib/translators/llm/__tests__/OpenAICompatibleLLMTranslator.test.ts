import {
	buildLLMPromptMessages,
	cleanLLMJsonResponse,
	DEFAULT_LLM_SYSTEM_PROMPT,
	DEFAULT_LLM_USER_PROMPT,
	OpenAICompatibleLLMTranslator,
	resolveChatCompletionsUrl,
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
});

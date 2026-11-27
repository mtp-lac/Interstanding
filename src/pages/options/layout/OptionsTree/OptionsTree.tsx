import React, {
	FC,
	ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Checkbox } from 'react-elegant-ui/esm/components/Checkbox/Checkbox.bundle/desktop';
import { get, isEqual } from 'lodash';

import { Hotkey } from '../../../../components/controls/Hotkey';
import { Button } from '../../../../components/primitives/Button/Button.bundle/desktop';
import { Select } from '../../../../components/primitives/Select/Select.bundle/desktop';
import { Textarea } from '../../../../components/primitives/Textarea/Textarea.bundle/desktop';
import { Textinput } from '../../../../components/primitives/Textinput/Textinput.bundle/desktop';
import {
	DEFAULT_THINKING_LEVELS,
	defaultLLMFallbackEndpoint,
	EndpointModelInfo,
	fetchEndpointMetadata,
} from '../../../../lib/translators/llm';
import { AppConfigType, LLMFallbackEndpointConfig } from '../../../../types/runtime';

import { OptionSection } from '../OptionSection/OptionSection';
import { cnOptionsPage } from '../OptionsPage';
import { PageSection } from '../PageSection/PageSection';

export interface LLMThinkingLevelLabels {
	defaultOption: string;
	levelNone: string;
	levelMinimal: string;
	levelLow: string;
	levelMedium: string;
	levelHigh: string;
	levelXHigh: string;
}

const DEFAULT_THINKING_LEVEL_LABELS: LLMThinkingLevelLabels = {
	defaultOption: 'Default (endpoint / model default)',
	levelNone: 'None (disabled)',
	levelMinimal: 'Minimal',
	levelLow: 'Low',
	levelMedium: 'Medium',
	levelHigh: 'High',
	levelXHigh: 'Extra high (xhigh)',
};

const formatThinkingLevelLabel = (
	level: string,
	labels: LLMThinkingLevelLabels,
): string => {
	switch (level.toLowerCase()) {
		case 'none':
			return labels.levelNone;
		case 'minimal':
			return labels.levelMinimal;
		case 'low':
			return labels.levelLow;
		case 'medium':
			return labels.levelMedium;
		case 'high':
			return labels.levelHigh;
		case 'xhigh':
			return labels.levelXHigh;
		default:
			return level.charAt(0).toUpperCase() + level.slice(1);
	}
};

export interface LLMModelPickerLabels {
	fetchButton: string;
	fetchingButton: string;
	selectModelPlaceholder: string;
	noModelsFound: string;
}

const DEFAULT_MODEL_PICKER_LABELS: LLMModelPickerLabels = {
	fetchButton: 'Fetch from endpoint',
	fetchingButton: 'Fetching...',
	selectModelPlaceholder: 'Select fetched model...',
	noModelsFound: 'Endpoint returned no models',
};

export interface LLMFallbacksEditorLabels extends LLMThinkingLevelLabels {
	addButton: string;
	removeButton: string;
	moveUpButton: string;
	moveDownButton: string;
	itemTitle: string;
	apiUrlPlaceholder: string;
	apiKeyPlaceholder: string;
	modelPlaceholder: string;
	temperaturePlaceholder: string;
	fetchButton: string;
	fetchingButton: string;
	selectModelPlaceholder: string;
	noModelsFound: string;
	thinkingLevelInherit: string;
	thinkingLevelDefault: string;
}

const DEFAULT_FALLBACK_LABELS: LLMFallbacksEditorLabels = {
	...DEFAULT_THINKING_LEVEL_LABELS,
	addButton: 'Add fallback endpoint',
	removeButton: 'Remove',
	moveUpButton: 'Up',
	moveDownButton: 'Down',
	itemTitle: 'Fallback',
	apiUrlPlaceholder: 'API base URL (leave blank to reuse primary endpoint)',
	apiKeyPlaceholder: 'API key (optional; reuses primary key if URL is blank)',
	modelPlaceholder: 'Model (e.g., gpt-4.1-mini, gpt-4o)',
	temperaturePlaceholder: 'Temperature (optional; inherits primary)',
	fetchButton: 'Fetch',
	fetchingButton: 'Fetching...',
	selectModelPlaceholder: 'Select fetched model...',
	noModelsFound: 'Endpoint returned no models',
	thinkingLevelInherit: 'Thinking level: Inherit from primary',
	thinkingLevelDefault: 'Thinking level: Default (endpoint / model default)',
};

interface FetchedEndpointState {
	loading: boolean;
	models: EndpointModelInfo[];
	thinkingLevels: string[];
	statusMessage?: string;
	errorMessage?: string;
}

const NumberInput: FC<{
	value: unknown;
	placeholder?: string;
	error?: string;
	allowEmpty?: boolean;
	onChangeNumber: (next: number | string | undefined) => void;
}> = ({ value, placeholder, error, allowEmpty = false, onChangeNumber }) => {
	const externalText =
		typeof value === 'number' && Number.isFinite(value)
			? String(value)
			: typeof value === 'string'
				? value
				: '';
	const [draft, setDraft] = useState<string>(externalText);
	const lastEmittedRef = useRef<unknown>(value);

	useEffect(() => {
		if (value !== lastEmittedRef.current) {
			lastEmittedRef.current = value;
			setDraft(externalText);
		}
	}, [externalText, value]);

	return (
		<Textinput
			state={error !== undefined ? 'error' : undefined}
			value={draft}
			placeholder={placeholder}
			spellCheck={false}
			onInputText={(raw) => {
				setDraft(raw);
				const trimmed = raw.trim();
				if (trimmed === '') {
					const nextValue = allowEmpty ? undefined : '';
					lastEmittedRef.current = nextValue;
					onChangeNumber(nextValue);
					return;
				}
				const parsed = Number(trimmed);
				if (Number.isFinite(parsed)) {
					lastEmittedRef.current = parsed;
					onChangeNumber(parsed);
				} else if (!allowEmpty) {
					lastEmittedRef.current = raw;
					onChangeNumber(raw);
				}
			}}
		/>
	);
};

const LLMFallbacksEditor: FC<{
	value: LLMFallbackEndpointConfig[];
	onChange: (next: LLMFallbackEndpointConfig[]) => void;
	primaryApiUrl: string;
	primaryApiKey: string;
	error?: string;
	labels?: Partial<LLMFallbacksEditorLabels>;
}> = ({ value, onChange, primaryApiUrl, primaryApiKey, error, labels: customLabels }) => {
	const items = Array.isArray(value) ? value : [];
	const labels = { ...DEFAULT_FALLBACK_LABELS, ...customLabels };
	const [fetchedByIndex, setFetchedByIndex] = useState<
		Record<number, FetchedEndpointState>
	>({});

	const updateItem = (index: number, patch: Partial<LLMFallbackEndpointConfig>) => {
		onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
	};

	const moveItem = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= items.length) return;
		const next = [...items];
		const [moved] = next.splice(index, 1);
		next.splice(target, 0, moved);
		setFetchedByIndex({});
		onChange(next);
	};

	const handleFetchForFallback = async (index: number) => {
		const item = items[index];
		if (!item) return;

		const rawUrl = typeof item.apiUrl === 'string' ? item.apiUrl.trim() : '';
		const rawKey = typeof item.apiKey === 'string' ? item.apiKey.trim() : '';
		const effectiveUrl = rawUrl || primaryApiUrl;
		const effectiveKey = rawKey || (rawUrl ? '' : primaryApiKey);

		setFetchedByIndex((prev) => ({
			...prev,
			[index]: {
				loading: true,
				models: prev[index]?.models ?? [],
				thinkingLevels: prev[index]?.thinkingLevels ?? [],
			},
		}));

		try {
			const result = await fetchEndpointMetadata({
				apiUrl: effectiveUrl,
				apiKey: effectiveKey,
				model: typeof item.model === 'string' ? item.model : '',
			});
			setFetchedByIndex((prev) => ({
				...prev,
				[index]: {
					loading: false,
					models: result.models,
					thinkingLevels: result.thinkingLevels,
					statusMessage:
						result.models.length > 0
							? `Fetched ${result.models.length} model(s)`
							: labels.noModelsFound,
				},
			}));
		} catch (fetchError) {
			const message =
				fetchError instanceof Error ? fetchError.message : String(fetchError);
			setFetchedByIndex((prev) => ({
				...prev,
				[index]: {
					loading: false,
					models: prev[index]?.models ?? [],
					thinkingLevels: prev[index]?.thinkingLevels ?? [],
					errorMessage: message,
				},
			}));
		}
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
			{items.map((item, index) => {
				const fetchState = fetchedByIndex[index];
				const currentModel = typeof item.model === 'string' ? item.model : '';
				const matchedModel = fetchState?.models.find(
					(m) => m.id === currentModel.trim(),
				);
				const availableLevels =
					matchedModel && matchedModel.thinkingLevels.length > 0
						? matchedModel.thinkingLevels
						: fetchState && fetchState.thinkingLevels.length > 0
							? fetchState.thinkingLevels
							: [...DEFAULT_THINKING_LEVELS];
				const currentThinking =
					typeof item.thinkingLevel === 'string'
						? item.thinkingLevel.trim().toLowerCase()
						: '';
				const mergedLevels =
					currentThinking !== '' &&
					currentThinking !== 'default' &&
					!availableLevels.includes(currentThinking)
						? [...availableLevels, currentThinking]
						: availableLevels;

				const thinkingOptions = [
					{ id: '', content: labels.thinkingLevelInherit },
					{ id: 'default', content: labels.thinkingLevelDefault },
					...mergedLevels.map((level) => ({
						id: level,
						content: formatThinkingLevelLabel(level, labels),
					})),
				];

				return (
					<div
						key={index}
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '8px',
							padding: '10px',
							border: '1px solid rgba(128, 128, 128, 0.35)',
							borderRadius: '6px',
						}}
					>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								gap: '8px',
							}}
						>
							<strong>
								{labels.itemTitle} #{index + 1}
							</strong>
							<div style={{ display: 'flex', gap: '6px' }}>
								<Button
									view="default"
									disabled={index === 0}
									onPress={() => moveItem(index, -1)}
								>
									{labels.moveUpButton}
								</Button>
								<Button
									view="default"
									disabled={index === items.length - 1}
									onPress={() => moveItem(index, 1)}
								>
									{labels.moveDownButton}
								</Button>
								<Button
									view="default"
									onPress={() => {
										setFetchedByIndex({});
										onChange(items.filter((_, i) => i !== index));
									}}
								>
									{labels.removeButton}
								</Button>
							</div>
						</div>
						<Textinput
							state={error !== undefined ? 'error' : undefined}
							value={typeof item.apiUrl === 'string' ? item.apiUrl : ''}
							placeholder={labels.apiUrlPlaceholder}
							spellCheck={false}
							onInputText={(apiUrl) => updateItem(index, { apiUrl })}
						/>
						<Textinput
							state={error !== undefined ? 'error' : undefined}
							value={typeof item.apiKey === 'string' ? item.apiKey : ''}
							placeholder={labels.apiKeyPlaceholder}
							controlProps={{ type: 'password' }}
							spellCheck={false}
							onInputText={(apiKey) => updateItem(index, { apiKey })}
						/>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '8px',
							}}
						>
							<div style={{ flex: 1 }}>
								<Textinput
									state={error !== undefined ? 'error' : undefined}
									value={currentModel}
									placeholder={labels.modelPlaceholder}
									spellCheck={false}
									onInputText={(model) => updateItem(index, { model })}
								/>
							</div>
							<Button
								view="default"
								disabled={fetchState?.loading}
								onPress={() => {
									void handleFetchForFallback(index);
								}}
							>
								{fetchState?.loading
									? labels.fetchingButton
									: labels.fetchButton}
							</Button>
						</div>
						{fetchState && fetchState.models.length > 0 && (
							<Select
								options={[
									{ id: '', content: labels.selectModelPlaceholder },
									...fetchState.models.map((m) => ({
										id: m.id,
										content:
											m.thinkingLevels.length > 0
												? `${m.id} (${m.thinkingLevels.join(', ')})`
												: m.id,
									})),
								]}
								value={
									fetchState.models.some(
										(m) => m.id === currentModel.trim(),
									)
										? currentModel.trim()
										: ''
								}
								setValue={(selected) => {
									if (typeof selected === 'string' && selected !== '') {
										updateItem(index, { model: selected });
									}
								}}
							/>
						)}
						{fetchState?.errorMessage && (
							<div
								style={{
									color: 'var(--color-typo-alert)',
									fontSize: '0.9em',
								}}
							>
								{fetchState.errorMessage}
							</div>
						)}
						{fetchState?.statusMessage && !fetchState.errorMessage && (
							<div
								style={{
									color: 'var(--color-typo-secondary)',
									fontSize: '0.9em',
								}}
							>
								{fetchState.statusMessage}
							</div>
						)}
						<Select
							options={thinkingOptions}
							value={currentThinking}
							setValue={(newThinking) => {
								if (typeof newThinking !== 'string') return;
								if (newThinking === '') {
									const {
										thinkingLevel: _omitted,
										...restWithoutThinking
									} = item;
									onChange(
										items.map((entry, i) =>
											i === index ? restWithoutThinking : entry,
										),
									);
								} else {
									updateItem(index, { thinkingLevel: newThinking });
								}
							}}
						/>
						<NumberInput
							error={error}
							value={item.temperature}
							placeholder={labels.temperaturePlaceholder}
							allowEmpty
							onChangeNumber={(nextTemp) => {
								if (typeof nextTemp !== 'number') {
									const {
										temperature: _omitted,
										...restWithoutTemperature
									} = item;
									onChange(
										items.map((entry, i) =>
											i === index ? restWithoutTemperature : entry,
										),
									);
									return;
								}
								updateItem(index, { temperature: nextTemp });
							}}
						/>
					</div>
				);
			})}
			<div>
				<Button
					view="default"
					onPress={() =>
						onChange([...items, { ...defaultLLMFallbackEndpoint }])
					}
				>
					{labels.addButton}
				</Button>
			</div>
		</div>
	);
};

export interface OptionSelectList {
	type: 'SelectList';
	options: {
		id: string;
		content: string;
	}[];
}

export interface OptionInputNumber {
	type: 'InputNumber';
}

export interface OptionInputText {
	type: 'InputText';
	password?: boolean;
	placeholder?: string;
}

export interface OptionInputMultiline {
	type: 'InputMultiline';
	placeholder?: string;
}

export interface OptionInputMultilineFromArray {
	type: 'InputMultilineFromArray';
}

export interface OptionCheckbox {
	type: 'Checkbox';
	reverse?: boolean;
	text?: string;
}

export interface OptionCheckboxGroup {
	type: 'CheckboxGroup';
	valueMap: string[];
	options: OptionCheckbox[];
}

export interface OptionButton {
	type: 'Button';
	text: string;
	view?: 'default' | 'action';
	disabled?: boolean;
	action: () => void;
}

export interface OptionHotkey {
	type: 'Hotkey';
}

export interface OptionLLMModel {
	type: 'LLMModel';
	placeholder?: string;
	labels?: Partial<LLMModelPickerLabels>;
}

export interface OptionLLMThinkingLevel {
	type: 'LLMThinkingLevel';
	labels?: Partial<LLMThinkingLevelLabels>;
}

export interface OptionLLMFallbacks {
	type: 'LLMFallbacks';
	labels?: Partial<LLMFallbacksEditorLabels>;
}

export interface OptionItem {
	title?: string;
	description?: ReactNode;
	/**
	 * Path to option property in object
	 */
	path?: string;
	optionContent:
		| OptionSelectList
		| OptionInputNumber
		| OptionInputText
		| OptionInputMultiline
		| OptionInputMultilineFromArray
		| OptionCheckbox
		| OptionCheckboxGroup
		| OptionButton
		| OptionHotkey
		| OptionLLMModel
		| OptionLLMThinkingLevel
		| OptionLLMFallbacks;
}

export interface OptionsGroup {
	title: string;
	titleSize?: 1 | 2 | 3 | 4 | 5 | 6;
	groupContent: (OptionsGroup | OptionItem | undefined)[];
}

interface OptionsTreeProps {
	tree: OptionsGroup[];
	config: AppConfigType;
	modifiedConfig: null | Record<string, any>;
	errors?: Record<string, string>;
	setOptionValue: (name: string, value: any) => void;
}

export const OptionsTree: FC<OptionsTreeProps> = ({
	tree,
	config,
	modifiedConfig,
	errors = {},
	setOptionValue,
}) => {
	const setOptionValueProxy = useCallback(
		(name: string | undefined, value: any) => {
			if (name === undefined) return;
			setOptionValue(name, value);
		},
		[setOptionValue],
	);

	const effectivePrimaryApiUrl = useMemo(() => {
		if (modifiedConfig !== null && 'llmTranslator.apiUrl' in modifiedConfig) {
			const val = modifiedConfig['llmTranslator.apiUrl'];
			return typeof val === 'string' ? val : '';
		}
		const saved = get(config, 'llmTranslator.apiUrl');
		return typeof saved === 'string' ? saved : '';
	}, [config, modifiedConfig]);

	const effectivePrimaryApiKey = useMemo(() => {
		if (modifiedConfig !== null && 'llmTranslator.apiKey' in modifiedConfig) {
			const val = modifiedConfig['llmTranslator.apiKey'];
			return typeof val === 'string' ? val : '';
		}
		const saved = get(config, 'llmTranslator.apiKey');
		return typeof saved === 'string' ? saved : '';
	}, [config, modifiedConfig]);

	const effectivePrimaryModel = useMemo(() => {
		if (modifiedConfig !== null && 'llmTranslator.model' in modifiedConfig) {
			const val = modifiedConfig['llmTranslator.model'];
			return typeof val === 'string' ? val : '';
		}
		const saved = get(config, 'llmTranslator.model');
		return typeof saved === 'string' ? saved : '';
	}, [config, modifiedConfig]);

	const [primaryEndpointFetch, setPrimaryEndpointFetch] =
		useState<FetchedEndpointState>({
			loading: false,
			models: [],
			thinkingLevels: [],
		});

	const handleFetchPrimaryEndpoint = useCallback(
		async (noModelsMessage: string) => {
			setPrimaryEndpointFetch((prev) => ({
				loading: true,
				models: prev.models,
				thinkingLevels: prev.thinkingLevels,
			}));

			try {
				const result = await fetchEndpointMetadata({
					apiUrl: effectivePrimaryApiUrl,
					apiKey: effectivePrimaryApiKey,
					model: effectivePrimaryModel,
				});
				setPrimaryEndpointFetch({
					loading: false,
					models: result.models,
					thinkingLevels: result.thinkingLevels,
					statusMessage:
						result.models.length > 0
							? `Fetched ${result.models.length} model(s)`
							: noModelsMessage,
				});
			} catch (fetchError) {
				const message =
					fetchError instanceof Error ? fetchError.message : String(fetchError);
				setPrimaryEndpointFetch((prev) => ({
					loading: false,
					models: prev.models,
					thinkingLevels: prev.thinkingLevels,
					errorMessage: message,
				}));
			}
		},
		[effectivePrimaryApiKey, effectivePrimaryApiUrl, effectivePrimaryModel],
	);

	const renderOption = useCallback(
		({ path, optionContent: option }: OptionItem, value: any, error?: string) => {
			switch (option.type) {
				case 'Checkbox': {
					const reverse = option.reverse ?? false;
					const checked = value === undefined ? undefined : reverse != !!value;
					return (
						<Checkbox
							checked={checked}
							setChecked={(checked) => {
								setOptionValueProxy(path, reverse != checked);
							}}
							label={option.text}
						/>
					);
				}
				case 'Hotkey': {
					return (
						<Hotkey
							value={value}
							onChange={(value) => {
								setOptionValueProxy(path, value);
							}}
						/>
					);
				}
				case 'CheckboxGroup': {
					if (!Array.isArray(value)) {
						throw new TypeError('value is not array');
					}

					return (
						<div
							className={cnOptionsPage('IndentMixin', {
								horizontal: true,
							})}
						>
							{option.options.map((checkbox, index) => {
								const optionName = option.valueMap[index];
								const valueIndex = value.indexOf(optionName);
								const isExistValue = valueIndex !== -1;
								const checked =
									(checkbox.reverse ?? false) !== isExistValue;
								return (
									<Checkbox
										key={index}
										checked={checked}
										setChecked={(checked) => {
											setOptionValueProxy(
												path,
												value
													.filter((val) => val !== optionName)
													.concat(
														(checkbox.reverse ?? false) !==
															checked
															? [optionName]
															: [],
													),
											);
										}}
										label={checkbox.text}
									/>
								);
							})}
						</div>
					);
				}
				case 'Button':
					return (
						<Button
							view={option.view ?? 'default'}
							onPress={option.action}
							disabled={option.disabled}
						>
							{option.text}
						</Button>
					);
				case 'InputMultilineFromArray':
					return (
						<Textarea
							autoResize
							state={error !== undefined ? 'error' : undefined}
							value={Array.isArray(value) ? value.join('\n') : undefined}
							spellCheck={false}
							onInputText={(value) => {
								const parsedArray = value.split('\n');
								setOptionValueProxy(
									path,
									parsedArray.length === 1 && parsedArray[0] === ''
										? []
										: parsedArray,
								);
							}}
						/>
					);
				case 'InputNumber':
					return (
						<NumberInput
							error={error}
							value={value}
							onChangeNumber={(nextValue) => {
								setOptionValueProxy(path, nextValue);
							}}
						/>
					);
				case 'InputText':
					return (
						<Textinput
							state={error !== undefined ? 'error' : undefined}
							value={typeof value === 'string' ? value : ''}
							placeholder={option.placeholder}
							controlProps={
								option.password ? { type: 'password' } : undefined
							}
							spellCheck={false}
							onInputText={(value) => {
								setOptionValueProxy(path, value);
							}}
						/>
					);
				case 'InputMultiline':
					return (
						<Textarea
							autoResize
							state={error !== undefined ? 'error' : undefined}
							value={typeof value === 'string' ? value : ''}
							placeholder={option.placeholder}
							spellCheck={false}
							onInputText={(value) => {
								setOptionValueProxy(path, value);
							}}
						/>
					);
				case 'SelectList':
					return (
						<Select
							options={option.options}
							value={value}
							setValue={(newValue) => {
								setOptionValueProxy(path, newValue);
							}}
						/>
					);
				case 'LLMModel': {
					const labels = {
						...DEFAULT_MODEL_PICKER_LABELS,
						...option.labels,
					};
					const currentModel = typeof value === 'string' ? value : '';
					return (
						<div
							style={{
								display: 'flex',
								flexDirection: 'column',
								gap: '8px',
							}}
						>
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '8px',
								}}
							>
								<div style={{ flex: 1 }}>
									<Textinput
										state={error !== undefined ? 'error' : undefined}
										value={currentModel}
										placeholder={option.placeholder}
										spellCheck={false}
										onInputText={(nextModel) => {
											setOptionValueProxy(path, nextModel);
										}}
									/>
								</div>
								<Button
									view="default"
									disabled={primaryEndpointFetch.loading}
									onPress={() => {
										void handleFetchPrimaryEndpoint(
											labels.noModelsFound,
										);
									}}
								>
									{primaryEndpointFetch.loading
										? labels.fetchingButton
										: labels.fetchButton}
								</Button>
							</div>
							{primaryEndpointFetch.models.length > 0 && (
								<Select
									options={[
										{
											id: '',
											content: labels.selectModelPlaceholder,
										},
										...primaryEndpointFetch.models.map((m) => ({
											id: m.id,
											content:
												m.thinkingLevels.length > 0
													? `${m.id} (${m.thinkingLevels.join(', ')})`
													: m.id,
										})),
									]}
									value={
										primaryEndpointFetch.models.some(
											(m) => m.id === currentModel.trim(),
										)
											? currentModel.trim()
											: ''
									}
									setValue={(selected) => {
										if (
											typeof selected === 'string' &&
											selected !== ''
										) {
											setOptionValueProxy(path, selected);
										}
									}}
								/>
							)}
							{primaryEndpointFetch.errorMessage && (
								<div
									style={{
										color: 'var(--color-typo-alert)',
										fontSize: '0.95em',
									}}
								>
									{primaryEndpointFetch.errorMessage}
								</div>
							)}
							{primaryEndpointFetch.statusMessage &&
								!primaryEndpointFetch.errorMessage && (
									<div
										style={{
											color: 'var(--color-typo-secondary)',
											fontSize: '0.95em',
										}}
									>
										{primaryEndpointFetch.statusMessage}
									</div>
								)}
						</div>
					);
				}
				case 'LLMThinkingLevel': {
					const labels = {
						...DEFAULT_THINKING_LEVEL_LABELS,
						...option.labels,
					};
					const currentThinking =
						typeof value === 'string' ? value.trim().toLowerCase() : '';
					const matchedModel = primaryEndpointFetch.models.find(
						(m) => m.id === effectivePrimaryModel.trim(),
					);
					const endpointLevels =
						matchedModel && matchedModel.thinkingLevels.length > 0
							? matchedModel.thinkingLevels
							: primaryEndpointFetch.thinkingLevels;
					const baseLevels =
						endpointLevels.length > 0
							? endpointLevels
							: [...DEFAULT_THINKING_LEVELS];
					const mergedLevels =
						currentThinking !== '' &&
						currentThinking !== 'default' &&
						!baseLevels.includes(currentThinking)
							? [...baseLevels, currentThinking]
							: baseLevels;

					const selectOptions = [
						{ id: '', content: labels.defaultOption },
						...mergedLevels.map((level) => ({
							id: level,
							content: formatThinkingLevelLabel(level, labels),
						})),
					];

					return (
						<div
							style={{
								display: 'flex',
								flexDirection: 'column',
								gap: '6px',
							}}
						>
							<Select
								options={selectOptions}
								value={
									currentThinking === 'default' ? '' : currentThinking
								}
								setValue={(newValue) => {
									if (typeof newValue === 'string') {
										setOptionValueProxy(path, newValue);
									}
								}}
							/>
							{endpointLevels.length > 0 && (
								<div
									style={{
										color: 'var(--color-typo-secondary)',
										fontSize: '0.95em',
									}}
								>
									Endpoint-supported levels: {endpointLevels.join(', ')}
								</div>
							)}
						</div>
					);
				}
				case 'LLMFallbacks':
					return (
						<LLMFallbacksEditor
							value={Array.isArray(value) ? value : []}
							primaryApiUrl={effectivePrimaryApiUrl}
							primaryApiKey={effectivePrimaryApiKey}
							error={error}
							labels={option.labels}
							onChange={(nextValue) => {
								setOptionValueProxy(path, nextValue);
							}}
						/>
					);
			}
		},
		[
			effectivePrimaryApiKey,
			effectivePrimaryApiUrl,
			effectivePrimaryModel,
			handleFetchPrimaryEndpoint,
			primaryEndpointFetch,
			setOptionValueProxy,
		],
	);

	const renderTree = useCallback(
		(tree: OptionsGroup['groupContent'], globalLevel = 1) => {
			const modifiedConfigStorage = modifiedConfig === null ? {} : modifiedConfig;

			return tree.map((item, index) => {
				if (item === undefined) return undefined;

				if ('optionContent' in item) {
					const { title, description, path } = item;

					let configValue = undefined;
					let changed = false;

					if (path !== undefined) {
						if (path in modifiedConfigStorage) {
							configValue = modifiedConfigStorage[path];
							if (!isEqual(configValue, get(config, path))) {
								changed = true;
							}
						} else {
							configValue = get(config, path);
						}
					}

					const error =
						path !== undefined && path in errors ? errors[path] : undefined;
					return (
						<OptionSection
							{...{ title, description, changed, error }}
							key={index}
						>
							{renderOption(item, configValue, error)}
						</OptionSection>
					);
				} else {
					const localLevel = (
						item.titleSize !== undefined
							? item.titleSize
							: globalLevel > 6
								? 6
								: globalLevel < 1
									? 1
									: globalLevel
					) as 1 | 2 | 3 | 4 | 5 | 6;

					return (
						<PageSection
							title={item.title}
							level={localLevel}
							key={index}
							className={cnOptionsPage(
								globalLevel > 2 ? 'Subgroup' : 'MainGroup',
							)}
						>
							<div
								className={cnOptionsPage('Container', {}, [
									cnOptionsPage('IndentMixin', { vertical: true }),
								])}
							>
								{renderTree(
									item.groupContent,
									item.title !== undefined
										? localLevel + 1
										: localLevel,
								)}
							</div>
						</PageSection>
					);
				}
			});
		},
		[config, errors, modifiedConfig, renderOption],
	);

	return <>{renderTree(tree, 2)}</>;
};

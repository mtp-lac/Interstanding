import React, { FC, ReactNode, useCallback } from 'react';
import { Checkbox } from 'react-elegant-ui/esm/components/Checkbox/Checkbox.bundle/desktop';
import { get, isEqual } from 'lodash';

import { Hotkey } from '../../../../components/controls/Hotkey';
import { Button } from '../../../../components/primitives/Button/Button.bundle/desktop';
import { Select } from '../../../../components/primitives/Select/Select.bundle/desktop';
import { Textarea } from '../../../../components/primitives/Textarea/Textarea.bundle/desktop';
import { Textinput } from '../../../../components/primitives/Textinput/Textinput.bundle/desktop';
import { defaultLLMFallbackEndpoint } from '../../../../lib/translators/llm';
import { AppConfigType, LLMFallbackEndpointConfig } from '../../../../types/runtime';

import { OptionSection } from '../OptionSection/OptionSection';
import { cnOptionsPage } from '../OptionsPage';
import { PageSection } from '../PageSection/PageSection';

export interface LLMFallbacksEditorLabels {
	addButton: string;
	removeButton: string;
	moveUpButton: string;
	moveDownButton: string;
	itemTitle: string;
	apiUrlPlaceholder: string;
	apiKeyPlaceholder: string;
	modelPlaceholder: string;
	temperaturePlaceholder: string;
}

const DEFAULT_FALLBACK_LABELS: LLMFallbacksEditorLabels = {
	addButton: 'Add fallback endpoint',
	removeButton: 'Remove',
	moveUpButton: 'Up',
	moveDownButton: 'Down',
	itemTitle: 'Fallback',
	apiUrlPlaceholder: 'API base URL (leave blank to reuse primary endpoint)',
	apiKeyPlaceholder: 'API key (optional; reuses primary key if URL is blank)',
	modelPlaceholder: 'Model (e.g., gpt-4.1-mini, gpt-4o)',
	temperaturePlaceholder: 'Temperature (optional; inherits primary)',
};

const LLMFallbacksEditor: FC<{
	value: LLMFallbackEndpointConfig[];
	onChange: (next: LLMFallbackEndpointConfig[]) => void;
	error?: string;
	labels?: Partial<LLMFallbacksEditorLabels>;
}> = ({ value, onChange, error, labels: customLabels }) => {
	const items = Array.isArray(value) ? value : [];
	const labels = { ...DEFAULT_FALLBACK_LABELS, ...customLabels };

	const updateItem = (index: number, patch: Partial<LLMFallbackEndpointConfig>) => {
		onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
	};

	const moveItem = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= items.length) return;
		const next = [...items];
		const [moved] = next.splice(index, 1);
		next.splice(target, 0, moved);
		onChange(next);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
			{items.map((item, index) => (
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
								onPress={() =>
									onChange(items.filter((_, i) => i !== index))
								}
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
					<Textinput
						state={error !== undefined ? 'error' : undefined}
						value={typeof item.model === 'string' ? item.model : ''}
						placeholder={labels.modelPlaceholder}
						spellCheck={false}
						onInputText={(model) => updateItem(index, { model })}
					/>
					<Textinput
						state={error !== undefined ? 'error' : undefined}
						value={
							typeof item.temperature === 'number' &&
							Number.isFinite(item.temperature)
								? String(item.temperature)
								: ''
						}
						placeholder={labels.temperaturePlaceholder}
						spellCheck={false}
						onInputText={(rawTemp) => {
							const trimmed = rawTemp.trim();
							if (trimmed === '') {
								onChange(
									items.map((entry, i) =>
										i === index
											? {
													apiUrl: item.apiUrl,
													apiKey: item.apiKey,
													model: item.model,
												}
											: entry,
									),
								);
								return;
							}
							const parsed = Number(trimmed);
							if (Number.isFinite(parsed)) {
								updateItem(index, { temperature: parsed });
							}
						}}
					/>
				</div>
			))}
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
						<Textinput
							state={error !== undefined ? 'error' : undefined}
							value={value}
							spellCheck={false}
							onInputText={(value) => {
								const parsedNumber = +value;
								setOptionValueProxy(
									path,
									isNaN(parsedNumber) ? value : parsedNumber,
								);
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
				case 'LLMFallbacks':
					return (
						<LLMFallbacksEditor
							value={Array.isArray(value) ? value : []}
							error={error}
							labels={option.labels}
							onChange={(nextValue) => {
								setOptionValueProxy(path, nextValue);
							}}
						/>
					);
			}
		},
		[setOptionValueProxy],
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

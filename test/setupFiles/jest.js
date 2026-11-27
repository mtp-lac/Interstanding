// Proxify global `jest` object,
// to make works packages with mocks, that actively use `jest` internally
globalThis.jest = vi;

// Provide in-memory Web Storage fallback when Node's experimental localStorage is uninitialized
if (typeof globalThis.localStorage === 'undefined') {
	const createMemoryStorage = () => {
		const store = new Map();
		return {
			get length() {
				return store.size;
			},
			clear() {
				store.clear();
			},
			getItem(key) {
				const k = String(key);
				return store.has(k) ? store.get(k) : null;
			},
			key(index) {
				return Array.from(store.keys())[index] ?? null;
			},
			removeItem(key) {
				store.delete(String(key));
			},
			setItem(key, value) {
				store.set(String(key), String(value));
			},
		};
	};

	Object.defineProperty(globalThis, 'localStorage', {
		value: createMemoryStorage(),
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, 'sessionStorage', {
		value: createMemoryStorage(),
		configurable: true,
		writable: true,
	});
}


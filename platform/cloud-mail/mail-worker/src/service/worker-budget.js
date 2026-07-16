export function boundedNumber(value, fallback, min, max) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

export function createWorkerBudget(options = {}) {
	const startedAt = Date.now();
	const maxMs = boundedNumber(options.maxMs, 25000, 1000, 50000);
	const maxItems = boundedNumber(options.maxItems, 10, 1, 100);
	let items = 0;

	return {
		startedAt,
		maxMs,
		maxItems,
		remainingMs() {
			return Math.max(0, maxMs - (Date.now() - startedAt));
		},
		canContinue() {
			return items < maxItems && Date.now() - startedAt < maxMs;
		},
		consume() {
			items += 1;
			return items;
		},
		snapshot() {
			return {
				maxMs,
				maxItems,
				processed: items,
				elapsedMs: Date.now() - startedAt,
				budgetExhausted: !this.canContinue()
			};
		}
	};
}

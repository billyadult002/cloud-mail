const SECRET_PATTERNS = [
	/sk-[A-Za-z0-9_-]+/g,
	/AIza[0-9A-Za-z_-]+/g,
	/Bearer\s+[A-Za-z0-9._-]+/gi,
	/(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)["'\s:=]+[^"',\s}]+/gi
];

const providerRuntimeRedactor = {
	redact(value) {
		if (value == null) return value;
		if (typeof value === 'string') {
			return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[redacted]'), value).slice(0, 800);
		}
		if (Array.isArray(value)) return value.map(item => this.redact(item));
		if (typeof value === 'object') {
			const out = {};
			for (const [key, child] of Object.entries(value)) {
				if (/secret|token|key|credential|authorization/i.test(key) && key !== 'credential_reference') {
					out[key] = '[redacted]';
				} else {
					out[key] = this.redact(child);
				}
			}
			return out;
		}
		return value;
	}
};

export default providerRuntimeRedactor;

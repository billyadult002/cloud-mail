import DOMPurify from 'dompurify';

// Central HTML sanitization for every untrusted-HTML sink in the app.
// Rationale (P0-1 / WF-1): inbound email HTML and admin notice HTML were being
// injected via innerHTML / dangerouslyUseHTMLString with no sanitization and no
// CSP, allowing stored XSS (e.g. <img onerror>, <svg onload>, javascript: URLs,
// inline event handlers) to execute in the authenticated app origin.

// Strip dangerous protocols even inside otherwise-allowed attributes.
const DANGEROUS_PROTOCOL = /^\s*(javascript|vbscript|data\s*:(?!image\/(png|jpe?g|gif|webp|bmp|svg\+xml)))/i;

let hooksInstalled = false;

function installHooks() {
	if (hooksInstalled) return;
	hooksInstalled = true;

	// Defense in depth: force all links to open safely and never leak the opener.
	DOMPurify.addHook('afterSanitizeAttributes', node => {
		if (node.tagName === 'A' && node.getAttribute('href')) {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer nofollow');
		}
		// Belt-and-suspenders: drop any href/src that survived with a bad scheme.
		for (const attr of ['href', 'src', 'xlink:href']) {
			const value = node.getAttribute && node.getAttribute(attr);
			if (value && DANGEROUS_PROTOCOL.test(value)) {
				node.removeAttribute(attr);
			}
		}
	});
}

const EMAIL_CONFIG = {
	// Block active-content and framing elements outright.
	FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'form', 'meta', 'link'],
	// FORBID_ATTR handles inline handlers; DOMPurify already drops on* by default,
	// this makes the intent explicit and covers a few extra vectors.
	FORBID_ATTR: ['srcdoc', 'ping', 'formaction'],
	ALLOW_DATA_ATTR: false,
	// Keep style attributes (email layout relies on them) but DOMPurify still
	// filters expression()/url(javascript:) inside them.
	ADD_ATTR: ['target', 'rel'],
	// Return a string; the caller assigns it to shadow DOM / innerHTML.
	RETURN_TRUSTED_TYPE: false
};

// Sanitize full email HTML bodies (rich layout allowed, no active content).
export function sanitizeEmailHtml(dirty) {
	if (!dirty) return '';
	installHooks();
	return DOMPurify.sanitize(String(dirty), EMAIL_CONFIG);
}

// Sanitize small admin/notice HTML snippets (stricter allowlist).
export function sanitizeNoticeHtml(dirty) {
	if (!dirty) return '';
	installHooks();
	return DOMPurify.sanitize(String(dirty), {
		ALLOWED_TAGS: ['a', 'b', 'i', 'em', 'strong', 'u', 'br', 'p', 'span', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4'],
		ALLOWED_ATTR: ['href', 'title', 'style', 'target', 'rel'],
		ALLOW_DATA_ATTR: false
	});
}

// Plain-text extraction that never executes markup (used for list previews).
export function htmlToSafeText(dirty) {
	if (!dirty) return '';
	// bodyContent-only + no DOM insertion; DOMPurify parses without loading
	// resources or firing handlers, then we read textContent.
	const clean = DOMPurify.sanitize(String(dirty), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
	return clean;
}

export default { sanitizeEmailHtml, sanitizeNoticeHtml, htmlToSafeText };

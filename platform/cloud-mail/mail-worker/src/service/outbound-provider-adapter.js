export const OutboundProviderKind = Object.freeze({
	CLOUDFLARE_EMAIL_SENDING: 'cloudflare_email_sending',
	RESEND: 'resend',
	AMAZON_SES: 'amazon_ses',
	POSTMARK: 'postmark',
	CLOUDMAIL_RELAY: 'cloudmail_relay'
});

export const OutboundProviderStatus = Object.freeze({
	READY: 'ready',
	UNAVAILABLE: 'unavailable',
	NOT_CONFIGURED: 'not_configured',
	BLOCKED: 'blocked'
});

class OutboundProviderAdapter {
	constructor(kind) {
		this.kind = kind;
	}

	async provisionDomain() {
		return { provider: this.kind, status: OutboundProviderStatus.NOT_CONFIGURED, requiredDnsRecords: [] };
	}

	async verifyDomain() {
		return { provider: this.kind, status: OutboundProviderStatus.NOT_CONFIGURED, requiredDnsRecords: [] };
	}

	async getRequiredDnsRecords() {
		return [];
	}

	async sendMessage() {
		throw new Error(`${this.kind} sendMessage is not configured.`);
	}

	async getDkimRecords(domain) {
		return (await this.getRequiredDnsRecords(domain)).filter(record => String(record.type || '').toUpperCase() === 'TXT'
			&& String(record.name || '').includes('._domainkey.'));
	}

	async getDomainStatus(domain) {
		return this.verifyDomain(domain);
	}

	async getBounceOrReturnPathStatus() {
		return { provider: this.kind, status: OutboundProviderStatus.NOT_CONFIGURED };
	}

	async getReturnPathRecords(domain) {
		return [
			{ type: 'CNAME', name: `bounce.${domain}`, content: `${this.kind}-return-path-required.example.invalid`, purpose: 'provider_return_path_metadata' }
		];
	}

	async handleBounce() {
		return { provider: this.kind, status: 'foundation_only', action: 'record_bounce_event', delivered: false };
	}

	async handleComplaint() {
		return { provider: this.kind, status: 'foundation_only', action: 'record_complaint_event', delivered: false };
	}

	async getSuppressionListStatus() {
		return { provider: this.kind, status: 'foundation_only', destructive: false };
	}

	async getDomainWarmupState() {
		return { provider: this.kind, status: 'not_started', send_pass_claimed: false };
	}

	async getProviderHealthState() {
		return { provider: this.kind, status: OutboundProviderStatus.NOT_CONFIGURED, send_pass_claimed: false };
	}

	classifyProviderAcceptedWithoutDelivered(response = {}) {
		return {
			provider: this.kind,
			providerAccepted: Boolean(response.id || response.messageId || response.provider_message_id),
			delivered: false,
			deliveryTruthState: 'provider_accepted',
			userFacingState: 'Provider accepted. Delivery is not confirmed.'
		};
	}
}

class CloudflareEmailSendingAdapter extends OutboundProviderAdapter {
	constructor() {
		super(OutboundProviderKind.CLOUDFLARE_EMAIL_SENDING);
	}

	async getRequiredDnsRecords(domain) {
		return [
			{ type: 'TXT', name: domain, content: 'v=spf1 include:_spf.mx.cloudflare.net ~all', purpose: 'spf' }
		];
	}

	async verifyDomain(domain, cloudflareState = {}) {
		const status = cloudflareState.emailSending?.status || cloudflareState.emailSending?.error || 'unknown';
		if (cloudflareState.emailSending?.authorized === false) {
			return {
				provider: this.kind,
				status: OutboundProviderStatus.BLOCKED,
				reason: 'cloudflare_email_sending_api_unauthorized',
				requiredDnsRecords: await this.getRequiredDnsRecords(domain)
			};
		}
		return {
			provider: this.kind,
			status: status === 'ready' ? OutboundProviderStatus.READY : OutboundProviderStatus.UNAVAILABLE,
			reason: status === 'ready' ? null : 'cloudflare_email_sending_not_ready',
			requiredDnsRecords: await this.getRequiredDnsRecords(domain)
		};
	}
}

class ResendAdapter extends OutboundProviderAdapter {
	constructor() {
		super(OutboundProviderKind.RESEND);
	}

	async verifyDomain(domain, cloudflareState = {}) {
		const configured = Boolean(cloudflareState.resendConfigured);
		return {
			provider: this.kind,
			status: configured ? OutboundProviderStatus.READY : OutboundProviderStatus.NOT_CONFIGURED,
			reason: configured ? null : 'resend_domain_token_not_configured',
			requiredDnsRecords: []
		};
	}
}

class AmazonSesAdapter extends OutboundProviderAdapter {
	constructor() {
		super(OutboundProviderKind.AMAZON_SES);
	}

	async verifyDomain() {
		return {
			provider: this.kind,
			status: OutboundProviderStatus.NOT_CONFIGURED,
			reason: 'amazon_ses_adapter_reserved_not_configured',
			requiredDnsRecords: []
		};
	}
}

class PostmarkAdapter extends OutboundProviderAdapter {
	constructor() {
		super(OutboundProviderKind.POSTMARK);
	}

	async verifyDomain() {
		return {
			provider: this.kind,
			status: OutboundProviderStatus.NOT_CONFIGURED,
			reason: 'postmark_adapter_reserved_not_configured',
			requiredDnsRecords: []
		};
	}
}

class CloudMailRelayAdapter extends OutboundProviderAdapter {
	constructor() {
		super(OutboundProviderKind.CLOUDMAIL_RELAY);
	}

	async verifyDomain() {
		return {
			provider: this.kind,
			status: OutboundProviderStatus.NOT_CONFIGURED,
			reason: 'future_cloudmail_relay_reserved',
			requiredDnsRecords: []
		};
	}
}

export function outboundProviderAdapters() {
	return [
		new CloudflareEmailSendingAdapter(),
		new ResendAdapter(),
		new AmazonSesAdapter(),
		new PostmarkAdapter(),
		new CloudMailRelayAdapter()
	];
}

export { OutboundProviderAdapter };

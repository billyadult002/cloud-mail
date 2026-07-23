const HEALTH_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
function classify(status) {
	if (status >= 200 && status < 300) return { classification:'HEALTHY', retryable:false, reauthorizationRequired:false };
	if (status === 401 || status === 403) return { classification:'REAUTHORIZATION_REQUIRED', retryable:false, reauthorizationRequired:true };
	if (status === 429) return { classification:'RATE_LIMITED', retryable:true, reauthorizationRequired:false };
	if (status >= 500) return { classification:'PROVIDER_TRANSIENT', retryable:true, reauthorizationRequired:false };
	return { classification:'PROVIDER_REJECTED', retryable:false, reauthorizationRequired:false };
}
const gmailConnectionAdapter = Object.freeze({
	provider:'google', adapter_id:'gmail-connection-health-v1',
	async evaluateHealth({ accessToken, fetchImpl=fetch, timeoutMs=2500 }) {
		if (!accessToken) return Object.freeze({ ok:false, classification:'ACCESS_TOKEN_MISSING', providerNetworkCalled:false, retryable:false, reauthorizationRequired:true, mailboxMutated:false });
		const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),Math.min(3000,Math.max(250,Number(timeoutMs))));
		try {
			const response=await fetchImpl(HEALTH_URL,{ method:'GET', headers:{ authorization:`Bearer ${accessToken}`, accept:'application/json' }, cache:'no-store', redirect:'error', signal:controller.signal });
			const decision=classify(Number(response.status));
			return Object.freeze({ ok:decision.classification==='HEALTHY', ...decision, providerHttpStatus:Number(response.status), providerNetworkCalled:true, mailboxMutated:false, operation:'gmail_profile_metadata' });
		} catch { return Object.freeze({ ok:false, classification:'PROVIDER_OUTCOME_AMBIGUOUS', providerNetworkCalled:true, retryable:true, reauthorizationRequired:false, mailboxMutated:false, operation:'gmail_profile_metadata' }); }
		finally { clearTimeout(timeout); }
	}
});
export { HEALTH_URL, classify };
export default gmailConnectionAdapter;

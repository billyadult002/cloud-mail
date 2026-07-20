export function removeExactAuthToken(authInfo, token) {
	if (!token || !Array.isArray(authInfo?.tokens)) return false;
	const index = authInfo.tokens.findIndex((candidate) => candidate === token);
	if (index < 0) return false;
	authInfo.tokens.splice(index, 1);
	return true;
}

export default { removeExactAuthToken };

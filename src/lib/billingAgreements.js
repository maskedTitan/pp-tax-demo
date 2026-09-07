import { getPayPalAccessToken } from '$lib/paypal.js';

const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const PAYPAL_PRODUCTION_API = 'https://api-m.paypal.com';

function getApiBase(isProduction = false) {
	return isProduction ? PAYPAL_PRODUCTION_API : PAYPAL_SANDBOX_API;
}

/**
 * Create a billing agreement token (legacy v1 API)
 * @param {object} agreementData - Agreement token request body
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function createBillingAgreementToken(agreementData, isProduction = false, paypalAccount) {
	const accessToken = await getPayPalAccessToken(isProduction, paypalAccount);

	const response = await fetch(`${getApiBase(isProduction)}/v1/billing-agreements/agreement-tokens`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify(agreementData)
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to create billing agreement token: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

/**
 * Look up a billing agreement by id (legacy v1 API).
 *
 * Used as a preflight before importing into Braintree: it proves whether the
 * agreement is visible to *our* PayPal REST app in *this* environment, which
 * separates a bad/expired agreement id from a Braintree<->PayPal linking issue.
 *
 * @param {string} agreementId - The B- prefixed agreement id
 * @param {boolean} isProduction - Whether to use production environment
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
export async function getBillingAgreement(agreementId, isProduction = false, paypalAccount) {
	const accessToken = await getPayPalAccessToken(isProduction, paypalAccount);

	const response = await fetch(
		`${getApiBase(isProduction)}/v1/billing-agreements/agreements/${encodeURIComponent(agreementId)}`,
		{
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			}
		}
	);

	let body;
	try {
		body = await response.json();
	} catch {
		body = null;
	}

	return { ok: response.ok, status: response.status, body };
}

/**
 * Execute a billing agreement after user approval (legacy v1 API)
 * @param {string} tokenId - The agreement token from the approval redirect
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function executeBillingAgreement(tokenId, isProduction = false, paypalAccount) {
	const accessToken = await getPayPalAccessToken(isProduction, paypalAccount);

	const response = await fetch(`${getApiBase(isProduction)}/v1/billing-agreements/agreements`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify({ token_id: tokenId })
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to execute billing agreement: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

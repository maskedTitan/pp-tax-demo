import { PUBLIC_PAYPAL_CLIENT_ID, PUBLIC_PAYPAL_PROD_CLIENT_ID } from '$env/static/public';
import { PAYPAL_CLIENT_SECRET, PAYPAL_PROD_CLIENT_SECRET } from '$env/static/private';

const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const PAYPAL_PRODUCTION_API = 'https://api-m.paypal.com';

/**
 * Get API base URL based on environment
 * @param {boolean} isProduction - Whether to use production environment
 */
function getApiBase(isProduction = false) {
	return isProduction ? PAYPAL_PRODUCTION_API : PAYPAL_SANDBOX_API;
}

/**
 * Get credentials based on environment
 * @param {boolean} isProduction - Whether to use production environment
 */
function getCredentials(isProduction = false) {
	return {
		clientId: isProduction ? PUBLIC_PAYPAL_PROD_CLIENT_ID : PUBLIC_PAYPAL_CLIENT_ID,
		clientSecret: isProduction ? PAYPAL_PROD_CLIENT_SECRET : PAYPAL_CLIENT_SECRET
	};
}

/**
 * Get PayPal access token using client credentials
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function getPayPalAccessToken(isProduction = false) {
	const { clientId, clientSecret } = getCredentials(isProduction);
	const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

	const response = await fetch(`${getApiBase(isProduction)}/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: `Basic ${auth}`
		},
		body: 'grant_type=client_credentials'
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to get access token: ${error}`);
	}

	const data = await response.json();
	return data.access_token;
}

/**
 * Create a PayPal order
 * @param {object} orderData - Order data
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function createPayPalOrder(orderData, isProduction = false) {
	const accessToken = await getPayPalAccessToken(isProduction);

	const response = await fetch(`${getApiBase(isProduction)}/v2/checkout/orders`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify(orderData)
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to create order: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

/**
 * Update a PayPal order (PATCH)
 * @param {string} orderId - Order ID
 * @param {object} patchData - Patch data
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function updatePayPalOrder(orderId, patchData, isProduction = false) {
	const accessToken = await getPayPalAccessToken(isProduction);

	const response = await fetch(`${getApiBase(isProduction)}/v2/checkout/orders/${orderId}`, {
		method: 'PATCH',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify(patchData)
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to update order: ${JSON.stringify(error)}`);
	}

	// PATCH returns 204 No Content on success
	return response.status === 204;
}

/**
 * Capture payment for an order
 * @param {string} orderId - Order ID
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function capturePayPalOrder(orderId, isProduction = false) {
	const accessToken = await getPayPalAccessToken(isProduction);

	const response = await fetch(`${getApiBase(isProduction)}/v2/checkout/orders/${orderId}/capture`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to capture order: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

/**
 * Get PayPal order details
 * @param {string} orderId - Order ID
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function getPayPalOrder(orderId, isProduction = false) {
	const accessToken = await getPayPalAccessToken(isProduction);

	const response = await fetch(`${getApiBase(isProduction)}/v2/checkout/orders/${orderId}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to get order: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

/**
 * Create a vault setup token for zero-dollar auth
 * @param {object} setupData - Setup token data
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function createVaultSetupToken(setupData, isProduction = false) {
	const accessToken = await getPayPalAccessToken(isProduction);

	const response = await fetch(`${getApiBase(isProduction)}/v3/vault/setup-tokens`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify(setupData)
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to create setup token: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

/**
 * Create a payment token from an approved setup token
 * @param {string} setupTokenId - Setup token ID
 * @param {boolean} isProduction - Whether to use production environment
 */
export async function createPaymentToken(setupTokenId, isProduction = false) {
	const accessToken = await getPayPalAccessToken(isProduction);

	const response = await fetch(`${getApiBase(isProduction)}/v3/vault/payment-tokens`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify({
			payment_source: {
				token: {
					id: setupTokenId,
					type: 'SETUP_TOKEN'
				}
			}
		})
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to create payment token: ${JSON.stringify(error)}`);
	}

	return await response.json();
}

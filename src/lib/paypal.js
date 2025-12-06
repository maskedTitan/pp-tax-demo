import { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } from '$env/static/private';

const PAYPAL_API_BASE = 'https://api-m.sandbox.paypal.com';

/**
 * Get PayPal access token using client credentials
 */
export async function getPayPalAccessToken() {
	const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

	const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
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
 */
export async function createPayPalOrder(orderData) {
	const accessToken = await getPayPalAccessToken();

	const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
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
 */
export async function updatePayPalOrder(orderId, patchData) {
	const accessToken = await getPayPalAccessToken();

	const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}`, {
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
 */
export async function capturePayPalOrder(orderId) {
	const accessToken = await getPayPalAccessToken();

	const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
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
 */
export async function getPayPalOrder(orderId) {
	const accessToken = await getPayPalAccessToken();

	const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}`, {
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

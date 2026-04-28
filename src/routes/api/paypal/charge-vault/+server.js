import { json } from '@sveltejs/kit';
import { getPayPalAccessToken } from '$lib/paypal.js';

const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const PAYPAL_PRODUCTION_API = 'https://api-m.paypal.com';

/**
 * POST /api/paypal/charge-vault
 * Charges a vaulted PayPal payment method
 */
export async function POST({ request }) {
	try {
		const body = await request.json();
		const isProduction = body.isProduction || false;
		const vaultId = body.vaultId;
		const amount = body.amount || '1.00';
		const currencyCode = body.currencyCode || 'USD';
		const description = body.description || 'Charge from vaulted payment';

		if (!vaultId) {
			return json(
				{ error: 'vaultId is required' },
				{ status: 400 }
			);
		}

		const accessToken = await getPayPalAccessToken(isProduction);
		const apiBase = isProduction ? PAYPAL_PRODUCTION_API : PAYPAL_SANDBOX_API;

		// Create and capture order using vaulted payment method
		const orderPayload = {
			intent: 'CAPTURE',
			purchase_units: [
				{
					description: description,
					amount: {
						currency_code: currencyCode,
						value: amount
					}
				}
			],
			payment_source: {
				paypal: {
					vault_id: vaultId
				}
			}
		};

		const response = await fetch(`${apiBase}/v2/checkout/orders`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${accessToken}`,
				'PayPal-Request-Id': `vault-charge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
			},
			body: JSON.stringify(orderPayload)
		});

		const orderData = await response.json();

		if (!response.ok) {
			console.error('PayPal API error:', orderData);
			throw new Error(orderData.message || JSON.stringify(orderData));
		}

		// Extract capture details
		const capture = orderData.purchase_units?.[0]?.payments?.captures?.[0];

		return json({
			id: orderData.id,
			status: orderData.status,
			payer: orderData.payer,
			capture: capture ? {
				id: capture.id,
				status: capture.status,
				amount: capture.amount,
				final_capture: capture.final_capture
			} : null
		});
	} catch (error) {
		console.error('Error charging vault:', error);
		return json(
			{
				error: error.message || 'Failed to charge vaulted payment'
			},
			{ status: 500 }
		);
	}
}

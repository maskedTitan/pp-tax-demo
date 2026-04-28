import { json } from '@sveltejs/kit';
import { createPaymentToken } from '$lib/paypal.js';

/**
 * POST /api/paypal/create-payment-token
 * Exchanges a vault setup token for a payment token after customer approval
 */
export async function POST({ request }) {
	try {
		const body = await request.json();
		const isProduction = body.isProduction || false;
		const setupTokenId = body.vaultSetupToken;

		if (!setupTokenId) {
			return json(
				{ error: 'vaultSetupToken is required' },
				{ status: 400 }
			);
		}

		const paymentToken = await createPaymentToken(setupTokenId, isProduction);

		return json({
			id: paymentToken.id,
			customer: paymentToken.customer,
			payment_source: paymentToken.payment_source,
			status: 'VAULTED'
		});
	} catch (error) {
		console.error('Error creating payment token:', error);
		return json(
			{
				error: error.message || 'Failed to create payment token'
			},
			{ status: 500 }
		);
	}
}

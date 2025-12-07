import { json } from '@sveltejs/kit';
import { capturePayPalOrder } from '$lib/paypal.js';

/**
 * POST /api/paypal/capture-order
 * Captures payment for a PayPal order
 */
export async function POST({ request }) {
	try {
		const { orderId, isProduction } = await request.json();

		if (!orderId) {
			return json({ error: 'Order ID is required' }, { status: 400 });
		}

		const captureData = await capturePayPalOrder(orderId, isProduction || false);

		// Extract vault ID if payment method was vaulted
		const vaultId =
			captureData.payment_source?.paypal?.attributes?.vault?.id || null;

		return json({
			id: captureData.id,
			status: captureData.status,
			payer: captureData.payer,
			purchase_units: captureData.purchase_units,
			payment_source: captureData.payment_source,
			vault_id: vaultId
		});
	} catch (error) {
		console.error('Error capturing PayPal order:', error);
		return json(
			{
				error: error.message || 'Failed to capture order'
			},
			{ status: 500 }
		);
	}
}

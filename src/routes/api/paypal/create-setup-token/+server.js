import { json } from '@sveltejs/kit';
import { createVaultSetupToken } from '$lib/paypal.js';

/**
 * POST /api/paypal/create-setup-token
 * Creates a PayPal vault setup token for saving payment method without purchase
 */
export async function POST({ request }) {
	try {
		const body = await request.json();
		const isProduction = body.isProduction || false;

		// Get the origin from the request headers for return/cancel URLs
		const origin = request.headers.get('origin') || 'http://localhost:5173';

		const setupData = {
			payment_source: {
				paypal: {
					usage_type: 'MERCHANT',
					experience_context: {
						return_url: body.return_url || `${origin}/`,
						cancel_url: body.cancel_url || `${origin}/`,
						brand_name: body.brand_name || 'Demo Store',
						shipping_preference: body.shipping_preference || 'GET_FROM_FILE'
					}
				}
			}
		};

		const setupToken = await createVaultSetupToken(setupData, isProduction);

		return json({
			id: setupToken.id,
			status: setupToken.status,
			links: setupToken.links
		});
	} catch (error) {
		console.error('Error creating setup token:', error);
		return json(
			{
				error: error.message || 'Failed to create setup token'
			},
			{ status: 500 }
		);
	}
}

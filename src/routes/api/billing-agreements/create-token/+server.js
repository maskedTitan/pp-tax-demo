import { json } from '@sveltejs/kit';
import { createBillingAgreementToken } from '$lib/billingAgreements.js';

/**
 * POST /api/billing-agreements/create-token
 * Creates a PayPal billing agreement token (legacy v1 API)
 */
export async function POST({ request }) {
	try {
		const body = await request.json();
		const isProduction = body.isProduction || false;

		const origin = request.headers.get('origin') || 'http://localhost:5173';

		const agreementData = {
			description: body.description || 'Billing Agreement',
			shipping_address: body.shipping_address || undefined,
			payer: {
				payment_method: 'PAYPAL'
			},
			plan: {
				type: 'MERCHANT_INITIATED_BILLING',
				merchant_preferences: {
					return_url: `${origin}/billing-agreements?approved=true`,
					cancel_url: `${origin}/billing-agreements?cancelled=true`,
					notify_url: body.notify_url || undefined,
					accepted_pymt_type: 'INSTANT',
					skip_shipping_address: body.skip_shipping_address || false,
					immutable_shipping_address: body.immutable_shipping_address || true
				}
			}
		};

		const result = await createBillingAgreementToken(agreementData, isProduction);

		// Extract the approval URL from links
		const approvalUrl = result.links?.find((link) => link.rel === 'approval_url')?.href;

		return json({
			token_id: result.token_id,
			approval_url: approvalUrl,
			links: result.links
		});
	} catch (error) {
		console.error('Error creating billing agreement token:', error);
		return json(
			{
				error: error.message || 'Failed to create billing agreement token'
			},
			{ status: 500 }
		);
	}
}

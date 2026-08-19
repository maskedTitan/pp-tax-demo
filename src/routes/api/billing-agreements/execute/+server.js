import { json } from '@sveltejs/kit';
import { executeBillingAgreement } from '$lib/billingAgreements.js';

/**
 * POST /api/billing-agreements/execute
 * Executes a billing agreement after user approval (legacy v1 API)
 */
export async function POST({ request }) {
	try {
		const body = await request.json();
		const { token, isProduction } = body;

		if (!token) {
			return json({ error: 'Missing agreement token' }, { status: 400 });
		}

		const result = await executeBillingAgreement(token, isProduction || false);

		return json({
			id: result.id,
			state: result.state,
			description: result.description,
			payer: result.payer,
			plan: result.plan,
			links: result.links
		});
	} catch (error) {
		console.error('Error executing billing agreement:', error);
		return json(
			{
				error: error.message || 'Failed to execute billing agreement'
			},
			{ status: 500 }
		);
	}
}

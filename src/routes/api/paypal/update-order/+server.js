import { json } from '@sveltejs/kit';
import { updatePayPalOrder } from '$lib/paypal.js';
import { calculateTax, calculateTotal } from '$lib/taxRates.js';

/**
 * POST /api/paypal/update-order
 * Updates a PayPal order with tax calculation based on shipping address
 */
export async function POST({ request }) {
	try {
		const { orderId, subtotal, stateCode, isProduction } = await request.json();

		if (!orderId || !subtotal) {
			return json({ error: 'Order ID and subtotal are required' }, { status: 400 });
		}

		// Calculate tax and total
		const taxAmount = calculateTax(subtotal, stateCode);
		const totalAmount = calculateTotal(subtotal, stateCode);

		// Build PATCH data to update the order
		const patchData = [
			{
				op: 'replace',
				path: "/purchase_units/@reference_id=='default'/amount",
				value: {
					currency_code: 'USD',
					value: totalAmount,
					breakdown: {
						item_total: {
							currency_code: 'USD',
							value: subtotal
						},
						tax_total: {
							currency_code: 'USD',
							value: taxAmount
						}
					}
				}
			}
		];

		// Update the order via PayPal API
		await updatePayPalOrder(orderId, patchData, isProduction || false);

		return json({
			success: true,
			subtotal: subtotal,
			tax: taxAmount,
			total: totalAmount,
			stateCode: stateCode
		});
	} catch (error) {
		console.error('Error updating PayPal order:', error);
		return json(
			{
				error: error.message || 'Failed to update order'
			},
			{ status: 500 }
		);
	}
}

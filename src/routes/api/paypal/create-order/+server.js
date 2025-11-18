import { json } from '@sveltejs/kit';
import { createPayPalOrder } from '$lib/paypal.js';
import { calculateTax, calculateTotal } from '$lib/taxRates.js';

/**
 * POST /api/paypal/create-order
 * Creates a PayPal order on the server-side
 */
export async function POST({ request }) {
	try {
		const body = await request.json();

		// Get the origin from the request headers for return/cancel URLs
		const origin = request.headers.get('origin') || 'http://localhost:5173';

		// Build the order data according to PayPal Orders v2 API
		const subtotal = body.amount || '10.00';

		// Calculate initial tax if shipping address is provided
		// This ensures new PayPal account users see correct amount
		let taxAmount = '0.00';
		let totalAmount = subtotal;

		if (body.shipping_address?.admin_area_1) {
			const initialState = body.shipping_address.admin_area_1;
			taxAmount = calculateTax(subtotal, initialState);
			totalAmount = calculateTotal(subtotal, initialState);
		}

		// Build purchase unit with optional shipping address
		const purchaseUnit = {
			reference_id: 'default',
			description: body.description || 'Sample Product',
			amount: {
				currency_code: body.currency_code || 'USD',
				value: totalAmount,
				breakdown: {
					item_total: {
						currency_code: body.currency_code || 'USD',
						value: subtotal
					},
					tax_total: {
						currency_code: body.currency_code || 'USD',
						value: taxAmount
					}
				}
			},
			items: [
				{
					name: body.description || 'Sample Product',
					unit_amount: {
						currency_code: body.currency_code || 'USD',
						value: subtotal
					},
					quantity: '1',
					category: 'PHYSICAL_GOODS'
				}
			]
		};

		// Add shipping address if provided
		if (body.shipping_address) {
			purchaseUnit.shipping = {
				name: {
					full_name: body.shipping_address.name
				},
				address: {
					address_line_1: body.shipping_address.address_line_1,
					address_line_2: body.shipping_address.address_line_2 || undefined,
					admin_area_2: body.shipping_address.admin_area_2,
					admin_area_1: body.shipping_address.admin_area_1,
					postal_code: body.shipping_address.postal_code,
					country_code: body.shipping_address.country_code
				}
			};
		}

		const orderData = {
			intent: 'CAPTURE',
			purchase_units: [purchaseUnit],
			payment_source: {
				paypal: {
					experience_context: {
						brand_name: body.brand_name || 'Your Store',
						landing_page: 'NO_PREFERENCE',
						user_action: 'PAY_NOW',
						shipping_preference: 'GET_FROM_FILE',
						return_url: body.return_url || `${origin}/`,
						cancel_url: body.cancel_url || `${origin}/`
					},
					attributes: {
						vault: {
							store_in_vault: 'ON_SUCCESS',
							usage_type: body.vault_usage_type || 'MERCHANT',
							customer_type: body.vault_customer_type || 'CONSUMER'
						}
					}
				}
			}
		};

		const order = await createPayPalOrder(orderData);

		return json({
			id: order.id,
			status: order.status,
			links: order.links
		});
	} catch (error) {
		console.error('Error creating PayPal order:', error);
		return json(
			{
				error: error.message || 'Failed to create order'
			},
			{ status: 500 }
		);
	}
}

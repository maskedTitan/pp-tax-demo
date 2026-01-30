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
		const isProduction = body.isProduction || false;

		// Get the origin from the request headers for return/cancel URLs
		const origin = request.headers.get('origin') || 'http://localhost:5173';

		// SECURITY: Defining source of truth for price on the server
		// In a real app, look this up from a database using a product ID
		const PRODUCT_PRICE = '1.00';

		// Enforce the price - ignore client provided amount for the item
		const subtotal = PRODUCT_PRICE;

		// Calculate tax server-side if address is provided
		let taxAmount = '0.00';
		if (body.shipping_address && body.shipping_address.admin_area_1) {
			taxAmount = calculateTax(subtotal, body.shipping_address.admin_area_1);
		}

		// Calculate total
		const totalAmount = (parseFloat(subtotal) + parseFloat(taxAmount)).toFixed(2);

		// Determine shipping preference early
		const shippingPref = body.shipping_preference || 'SET_PROVIDED_ADDRESS';

		// Build purchase unit with optional shipping address
		const purchaseUnit = {
			reference_id: 'default',
			description: body.description || 'Sample Product',
			amount: {
				currency_code: body.currency_code || 'USD',
				value: totalAmount
			}
		};

		// Only add breakdown and items if NOT using NO_SHIPPING
		// Per PayPal docs, when using NO_SHIPPING, keep the request minimal
		if (shippingPref !== 'NO_SHIPPING') {
			purchaseUnit.amount.breakdown = {
				item_total: {
					currency_code: body.currency_code || 'USD',
					value: subtotal
				},
				tax_total: {
					currency_code: body.currency_code || 'USD',
					value: taxAmount
				}
			};
			purchaseUnit.items = [
				{
					name: body.description || 'Sample Product',
					unit_amount: {
						currency_code: body.currency_code || 'USD',
						value: subtotal
					},
					quantity: '1',
					category: 'PHYSICAL_GOODS'
				}
			];
		}

		// Add shipping address if provided AND NOT Venmo AND NOT NO_SHIPPING
		// We skip adding the explicit shipping address object for Venmo to strictly follow "GET_FROM_FILE" flow
		// Also skip if NO_SHIPPING is explicitly requested
		if (body.shipping_address && body.paymentSource !== 'venmo' && shippingPref !== 'NO_SHIPPING') {
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


		let paymentSource = {};

		const experienceContext = {
			brand_name: body.brand_name || 'Your Store',
			landing_page: 'NO_PREFERENCE',
			user_action: 'PAY_NOW',
			shipping_preference: shippingPref,
			return_url: body.return_url || `${origin}/`,
			cancel_url: body.cancel_url || `${origin}/`
		};

		// Venmo DOES support NO_SHIPPING according to PayPal docs
		// Use the same experience_context for Venmo as requested
		const requestVaulting = body.requestVaulting || false;

		if (body.paymentSource === 'venmo') {
			paymentSource = {
				venmo: {
					experience_context: experienceContext
				}
			};

			if (requestVaulting) {
				paymentSource.venmo.attributes = {
					vault: {
						store_in_vault: 'ON_SUCCESS',
						usage_type: body.vault_usage_type || 'MERCHANT',
						customer_type: body.vault_customer_type || 'CONSUMER'
					}
				};
			}
		} else {
			paymentSource = {
				paypal: {
					experience_context: experienceContext,
					// Only add vault attributes if requested (or default behavior)
					attributes: requestVaulting ? {
						vault: {
							store_in_vault: 'ON_SUCCESS',
							usage_type: body.vault_usage_type || 'MERCHANT',
							customer_type: body.vault_customer_type || 'CONSUMER'
						}
					} : undefined
				}
			};
		}

		const orderData = {
			intent: 'CAPTURE',
			purchase_units: [purchaseUnit],
			payment_source: paymentSource
		};

		const order = await createPayPalOrder(orderData, isProduction);

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

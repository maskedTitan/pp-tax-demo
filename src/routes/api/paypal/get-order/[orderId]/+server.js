import { json } from '@sveltejs/kit';
import { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } from '$env/static/private';

const PAYPAL_API_BASE = 'https://api-m.sandbox.paypal.com';

/**
 * Get PayPal Access Token
 */
async function getAccessToken() {
    console.log('Getting PayPal access token...');
    console.log('Client ID:', PAYPAL_CLIENT_ID ? `${PAYPAL_CLIENT_ID.substring(0, 10)}...` : 'NOT SET');
    console.log('Client Secret:', PAYPAL_CLIENT_SECRET ? 'SET' : 'NOT SET');

    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

    const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    const data = await response.json();

    if (!response.ok) {
        console.error('Token fetch failed:', data);
        throw new Error(`Failed to get access token: ${data.error_description || data.error}`);
    }

    console.log('Access token obtained successfully');
    return data.access_token;
}

/**
 * GET /api/paypal/get-order/[orderId]
 * Retrieves order details from PayPal Orders v2 API
 */
export async function GET({ params }) {
    try {
        const { orderId } = params;

        // Get access token
        const accessToken = await getAccessToken();

        // Get order details
        const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const orderData = await response.json();

        if (!response.ok) {
            console.error('PayPal API Error:', orderData);
            return json(
                {
                    error: 'Failed to fetch order',
                    details: orderData,
                    status: response.status
                },
                { status: response.status }
            );
        }

        return json(orderData, { status: 200 });
    } catch (error) {
        console.error('Error fetching PayPal order:', error);
        return json(
            {
                error: error.message || 'Failed to fetch order details',
                stack: error.stack
            },
            { status: 500 }
        );
    }
}

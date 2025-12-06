// Imports removed to avoid SvelteKit alias issues
// import { createPayPalOrder, updatePayPalOrder } from './src/lib/paypal.js';
// import { calculateTax, calculateTotal } from './src/lib/taxRates.js';

// Mock environment variables for the script to run standalone
// Note: This requires the actual env vars to be present or loaded.
// Since we are running in the user's environment, we might need to load .env
// But for now, let's try to run it via `vite-node` or similar if available, 
// or just rely on the fact that we can't easily run this standalone without setup.

// Alternative: Use `curl` against the running server.
// The server is running at http://localhost:5173

async function runVerification() {
    const baseUrl = 'http://localhost:5173';

    console.log('1. Creating Order...');
    const createRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            amount: '10.00',
            shipping_preference: 'SET_PROVIDED_ADDRESS',
            shipping_address: {
                name: 'Original Name',
                address_line_1: '123 Original St',
                admin_area_2: 'San Jose',
                admin_area_1: 'CA',
                postal_code: '95131',
                country_code: 'US'
            }
        })
    });

    if (!createRes.ok) {
        console.error('Failed to create order:', await createRes.text());
        return;
    }

    const order = await createRes.json();
    console.log('Order Created:', order.id);

    console.log('2. Updating Order with New Address (Simulating Guest Checkout Change)...');
    const updateRes = await fetch(`${baseUrl}/api/paypal/update-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            orderId: order.id,
            subtotal: '10.00',
            stateCode: 'NY',
            shippingAddress: {
                line1: '456 New St',
                city: 'New York',
                state: 'NY',
                postalCode: '10001',
                countryCode: 'US'
            }
        })
    });

    if (!updateRes.ok) {
        console.error('Failed to update order:', await updateRes.text());
        return;
    }

    const updateData = await updateRes.json();
    console.log('Update Response:', updateData);

    if (updateData.success) {
        console.log('SUCCESS: Order updated successfully. The server logic for patching address executed without error.');
    } else {
        console.error('FAILURE: Update reported failure.');
    }
}

runVerification();

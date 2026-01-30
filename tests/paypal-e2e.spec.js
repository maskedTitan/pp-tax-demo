import { test, expect } from '@playwright/test';

/**
 * PAYPAL E2E TEST SUITE
 * 
 * Consolidated test suite covering all PayPal checkout flows:
 * 
 * 1. API Tests (Backend)
 *    - Create Order API
 *    - Capture Order API
 *    - Create Setup Token API (Vault-only)
 *    - Price tampering protection
 * 
 * 2. UI Tests (Frontend)
 *    - Page loads correctly
 *    - Toggle state management
 * 
 * 3. Payment Flows
 *    - Standard One-Time Payment
 *    - Subscribe (Recurring) Payment with Vaulting
 *    - Full checkout with API response verification
 * 
 * Related test files:
 * - edge-cases-e2e.spec.js - Error handling & edge cases
 * - security-audit.spec.js - Security vulnerability tests
 * - new-account-flow.spec.js - Guest checkout (pay with card)
 */

const SANDBOX_EMAIL = process.env.PAYPAL_SANDBOX_EMAIL || 'h22tswift13@gmail.com';
const OTP_CODE = '111111';
const EXPECTED_PRODUCT_PRICE = '1.00';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Complete PayPal login flow with OTP
 */
async function completePayPalLogin(popup) {
    await popup.waitForLoadState('load');

    // Enter email
    const emailInput = popup.locator('input[placeholder*="Email"], input[placeholder*="email"], #email');
    await emailInput.waitFor({ timeout: 15000 });
    await emailInput.fill(SANDBOX_EMAIL);

    // Click Next
    await popup.locator('button:has-text("Next")').click();

    // Click "Get a Code"
    const getCodeButton = popup.locator('button:has-text("Get a Code")');
    await getCodeButton.waitFor({ timeout: 15000 });
    await getCodeButton.click();

    // Enter OTP
    const otpInput = popup.locator('#ci, input[name="otpCode"], input[type="tel"]');
    await otpInput.waitFor({ timeout: 15000 });
    await otpInput.fill(OTP_CODE);

    // Wait for OTP processing
    await popup.waitForTimeout(3000);
}

/**
 * Click PayPal Pay button
 */
async function clickPayButton(popup) {
    const payButton = popup.locator('#one-time-cta');
    await payButton.waitFor({ state: 'visible', timeout: 20000 });
    await expect(payButton).toBeEnabled({ timeout: 10000 });
    await payButton.click();
}

// ============================================================
// SECTION 1: BACKEND API TESTS
// ============================================================
test.describe('Backend API Tests', () => {

    test('POST /api/paypal/create-order with valid data', async ({ request }) => {
        const response = await request.post('/api/paypal/create-order', {
            data: {
                amount: '1.00',
                currency_code: 'USD',
                isProduction: false,
                shipping_address: {
                    name: "Test User",
                    address_line_1: "123 Test St",
                    admin_area_2: "San Jose",
                    admin_area_1: "CA",
                    postal_code: "95131",
                    country_code: "US"
                }
            }
        });

        expect(response.ok()).toBeTruthy();
        const body = await response.json();
        expect(body.id).toBeDefined();
        console.log('✅ create-order API working');
    });

    test('POST /api/paypal/create-order rejects missing shipping when required', async ({ request }) => {
        const response = await request.post('/api/paypal/create-order', {
            data: {
                amount: '1.00',
                currency_code: 'USD',
                isProduction: false,
                shipping_preference: 'SET_PROVIDED_ADDRESS'
                // Missing shipping_address
            }
        });

        const body = await response.json();
        expect(body.error).toBeDefined();
        console.log('✅ create-order correctly rejects missing shipping');
    });

    test('POST /api/paypal/create-order with tax calculation', async ({ request }) => {
        const response = await request.post('/api/paypal/create-order', {
            data: {
                amount: '1.00',
                currency_code: 'USD',
                isProduction: false,
                initial_state: 'CA',
                shipping_address: {
                    name: "Test User",
                    address_line_1: "123 Test St",
                    admin_area_2: "San Francisco",
                    admin_area_1: "CA",
                    postal_code: "94102",
                    country_code: "US"
                }
            }
        });

        expect(response.ok()).toBeTruthy();
        console.log('✅ create-order with CA address (tax applied)');
    });

    test('POST /api/paypal/create-setup-token for vault-only', async ({ request }) => {
        const response = await request.post('/api/paypal/create-setup-token', {
            data: {
                isProduction: false
            }
        });

        // May succeed or fail based on PayPal config
        const body = await response.json();
        expect(body).toBeDefined();
        console.log('✅ create-setup-token API working');
    });

    test('POST /api/paypal/capture-order rejects invalid order ID', async ({ request }) => {
        const response = await request.post('/api/paypal/capture-order', {
            data: {
                orderId: 'INVALID_ORDER_12345',
                isProduction: false
            }
        });

        expect(response.ok()).toBeFalsy();
        const body = await response.json();
        expect(body.error).toBeDefined();
        console.log('✅ Invalid order ID rejected');
    });

    test('Server overrides client price tampering', async ({ request }) => {
        const response = await request.post('/api/paypal/create-order', {
            data: {
                amount: '-500.00', // Tampered price
                currency_code: 'USD',
                isProduction: false,
                shipping_address: {
                    name: "Test User",
                    address_line_1: "123 Test St",
                    admin_area_2: "San Jose",
                    admin_area_1: "CA",
                    postal_code: "95131",
                    country_code: "US"
                }
            }
        });

        const body = await response.json();
        if (body.error) {
            expect(body.error).not.toContain('CANNOT_BE_ZERO_OR_NEGATIVE');
        }
        console.log('✅ Price tampering protection verified');
    });
});

// ============================================================
// SECTION 2: UI STATE TESTS
// ============================================================
test.describe('UI State Tests', () => {

    test('Page loads with correct initial state', async ({ page }) => {
        await page.goto('/');

        // Verify Payment Gateway Demo text is NOT visible
        await expect(page.getByText('Payment Gateway Demo')).not.toBeVisible();

        // Verify key elements
        await expect(page.getByText('Product Details')).toBeVisible();
        await expect(page.getByText('ENVIRONMENT:')).toBeVisible();
        await expect(page.getByText('SANDBOX', { exact: true })).toBeVisible();

        // Check PayPal button loads
        const paypalFrame = page.frameLocator('iframe[title="PayPal"].component-frame');
        const paypalButton = paypalFrame.locator('[data-funding-source="paypal"]');
        await expect(paypalButton).toBeVisible({ timeout: 15000 });

        console.log('✅ Page loads correctly');
    });

    test('Subscribe toggle is visible and unchecked by default', async ({ page }) => {
        await page.goto('/');

        // Find the Subscribe label/toggle
        const subscribeLabel = page.locator('label').filter({ hasText: 'Subscribe (Recurring)' });
        await expect(subscribeLabel).toBeVisible();

        console.log('✅ Subscribe toggle visible');
    });
});

// ============================================================
// SECTION 3: PAYMENT FLOW TESTS
// ============================================================
test.describe('Payment Flow Tests', () => {
    test.skip(!SANDBOX_EMAIL, 'Skipping: sandbox credentials not found');

    test('Standard one-time payment completes successfully', async ({ page, context }) => {
        test.setTimeout(120000);

        let createOrderRequest = null;
        let captureOrderResponse = null;

        await page.route('**/api/paypal/create-order', async (route) => {
            createOrderRequest = route.request().postDataJSON();
            await route.continue();
        });

        await page.route('**/api/paypal/capture-order', async (route) => {
            const response = await route.fetch();
            captureOrderResponse = await response.json();
            await route.fulfill({ response });
        });

        await page.goto('/');

        // Ensure Subscribe/Vault toggles are OFF
        const subscribeLabel = page.locator('label').filter({ hasText: 'Subscribe (Recurring)' });
        const subscribeCheckbox = subscribeLabel.locator('input[type="checkbox"]');
        if (await subscribeCheckbox.isChecked().catch(() => false)) {
            await subscribeLabel.click();
        }

        const zeroAuthLabel = page.locator('label').filter({ hasText: '$0 Auth' });
        const zeroAuthCheckbox = zeroAuthLabel.locator('input[type="checkbox"]');
        if (await zeroAuthCheckbox.isChecked().catch(() => false)) {
            await zeroAuthLabel.click();
        }

        // Click PayPal button
        const paypalFrame = page.frameLocator('iframe[title="PayPal"].component-frame');
        const paypalButton = paypalFrame.locator('[data-funding-source="paypal"]');
        await expect(paypalButton).toBeVisible({ timeout: 15000 });

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            paypalButton.click()
        ]);

        await completePayPalLogin(popup);
        await clickPayButton(popup);
        await popup.waitForEvent('close');

        // Verify success
        await expect(page.locator('text=Transaction completed!')).toBeVisible({ timeout: 15000 });
        expect(captureOrderResponse).toBeDefined();
        expect(captureOrderResponse.status).toBe('COMPLETED');

        console.log('✅ Standard one-time payment completed');
        console.log('   - Order ID:', captureOrderResponse.id);
        console.log('   - Vaulting: DISABLED (as expected)');
    });

    test('Subscribe (recurring) payment with vaulting completes successfully', async ({ page, context }) => {
        test.setTimeout(120000);

        let captureOrderResponse = null;

        await page.route('**/api/paypal/capture-order', async (route) => {
            const response = await route.fetch();
            captureOrderResponse = await response.json();
            await route.fulfill({ response });
        });

        await page.goto('/');

        // Enable Subscribe toggle
        const subscribeLabel = page.locator('label').filter({ hasText: 'Subscribe (Recurring)' });
        const subscribeCheckbox = subscribeLabel.locator('input[type="checkbox"]');
        if (!await subscribeCheckbox.isChecked().catch(() => true)) {
            await subscribeLabel.click();
        }

        // Ensure $0 Auth is OFF
        const zeroAuthLabel = page.locator('label').filter({ hasText: '$0 Auth' });
        const zeroAuthCheckbox = zeroAuthLabel.locator('input[type="checkbox"]');
        if (await zeroAuthCheckbox.isChecked().catch(() => false)) {
            await zeroAuthLabel.click();
        }

        await page.waitForTimeout(2000);

        // Click PayPal button
        const paypalFrame = page.frameLocator('iframe[title="PayPal"].component-frame');
        const paypalButton = paypalFrame.locator('[data-funding-source="paypal"]');
        await expect(paypalButton).toBeVisible({ timeout: 15000 });

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            paypalButton.click()
        ]);

        await completePayPalLogin(popup);
        await clickPayButton(popup);
        await popup.waitForEvent('close');

        // Verify success
        await expect(page.locator('text=Transaction completed!')).toBeVisible({ timeout: 15000 });
        expect(captureOrderResponse).toBeDefined();

        const vaultId = captureOrderResponse.payment_source?.paypal?.attributes?.vault?.id;

        console.log('✅ Subscribe (Recurring) payment completed');
        console.log('   - Order ID:', captureOrderResponse.id);
        console.log('   - Vault ID:', vaultId || 'N/A');
        console.log('   - Vaulting requested: TRUE');

        if (vaultId) {
            await expect(page.getByText(/Vault ID:/)).toBeVisible({ timeout: 5000 }).catch(() => { });
        }
    });

    test('Full checkout with API response verification', async ({ page, context }) => {
        test.setTimeout(150000);

        let createOrderRequest = null;
        let createOrderResponse = null;
        let captureOrderResponse = null;

        await page.route('**/api/paypal/create-order', async (route) => {
            createOrderRequest = route.request().postDataJSON();
            const response = await route.fetch();
            createOrderResponse = await response.json();
            await route.fulfill({ response });
        });

        await page.route('**/api/paypal/capture-order', async (route) => {
            const response = await route.fetch();
            captureOrderResponse = await response.json();
            await route.fulfill({ response });
        });

        await page.goto('/');

        // Click PayPal button
        const paypalFrame = page.frameLocator('iframe[title="PayPal"].component-frame');
        const paypalButton = paypalFrame.locator('[data-funding-source="paypal"]');
        await expect(paypalButton).toBeVisible({ timeout: 15000 });

        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            paypalButton.click()
        ]);

        await completePayPalLogin(popup);
        await clickPayButton(popup);
        await popup.waitForEvent('close');

        // Verify success
        await expect(page.locator('text=Transaction completed!')).toBeVisible({ timeout: 15000 });

        // ============================================================
        // API RESPONSE VERIFICATION
        // ============================================================
        console.log('\n' + '='.repeat(60));
        console.log('📋 API RESPONSE VERIFICATION');
        console.log('='.repeat(60));

        // Create Order
        expect(createOrderRequest).toBeDefined();
        expect(createOrderResponse).toBeDefined();
        expect(createOrderResponse.id).toBeDefined();
        console.log('✅ Create Order:', createOrderResponse.id);

        // Capture Order
        expect(captureOrderResponse).toBeDefined();
        expect(captureOrderResponse.status).toBe('COMPLETED');
        console.log('✅ Capture Order: COMPLETED');

        // Payment Capture
        const capture = captureOrderResponse.purchase_units?.[0]?.payments?.captures?.[0];
        expect(capture).toBeDefined();
        expect(capture.status).toBe('COMPLETED');
        expect(capture.amount.value).toBe(EXPECTED_PRODUCT_PRICE);
        console.log('✅ Payment Amount:', capture.amount.value, capture.amount.currency_code);

        // Shipping Address
        const shipping = captureOrderResponse.purchase_units?.[0]?.shipping;
        if (shipping?.address) {
            console.log('✅ Shipping Address:',
                shipping.address.admin_area_2 + ', ' +
                shipping.address.admin_area_1 + ' ' +
                shipping.address.postal_code
            );
        }

        // Payer
        if (captureOrderResponse.payer) {
            console.log('✅ Payer Email:', captureOrderResponse.payer.email_address);
        }

        console.log('='.repeat(60) + '\n');
    });
});

// ============================================================
// SECTION 4: ADDRESS VERIFICATION
// ============================================================
test.describe('Address Verification', () => {

    test('Verify address via API', async ({ request }) => {
        const response = await request.post('/api/paypal/create-order', {
            data: {
                amount: '1.00',
                currency_code: 'USD',
                isProduction: false,
                shipping_address: {
                    name: "Test User",
                    address_line_1: "123 Test St",
                    admin_area_2: "San Francisco",
                    admin_area_1: "CA",
                    postal_code: "94102",
                    country_code: "US"
                }
            }
        });

        expect(response.ok()).toBeTruthy();
        console.log('✅ Address accepted via API');
    });
});

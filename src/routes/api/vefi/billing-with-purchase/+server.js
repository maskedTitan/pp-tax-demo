import { json } from '@sveltejs/kit';
import { gateway, braintreeGraphql } from '$lib/server/braintree.js';

const MERCHANT_ACCOUNT_ID = 'paypal_au';

const CREATE_CUSTOMER = `
mutation CreateCustomer($input: CreateCustomerInput!) {
  createCustomer(input: $input) {
    customer { id legacyId }
  }
}`;

const VAULT_BILLING_AGREEMENT = `
mutation VaultPayPalBillingAgreement($input: VaultPayPalBillingAgreementInput!) {
  vaultPayPalBillingAgreement(input: $input) {
    paymentMethod {
      id
      legacyId
      details {
        ... on PayPalAccountDetails {
          email
          payerId
          billingAgreementId
        }
      }
    }
  }
}`;

const CHARGE_PAYMENT_METHOD = `
mutation ChargePaymentMethod($input: ChargePaymentMethodInput!) {
  chargePaymentMethod(input: $input) {
    transaction {
      id
      legacyId
      status
      amount { value currencyCode }
    }
  }
}`;

/**
 * POST /api/vefi/billing-with-purchase
 * Body: { nonce, amount, billingAgreementId? }
 *
 * When billingAgreementId is present (from tokenizePayment details) we vault
 * via the vaultPayPalBillingAgreement GraphQL mutation which accepts
 * merchantAccountId — this routes through the paypal_au PayPal link which has
 * Reference Transactions enabled.
 *
 * paymentMethod.create (Node SDK) ignores merchantAccountId and always uses
 * the gateway's default PayPal link, which is why it fails with the
 * Pre-Approved Payment error even when paypal_au has the feature on.
 */
export async function POST({ request }) {
    try {
        const { nonce, amount, billingAgreementId } = await request.json();

        if (!nonce || !amount) {
            return json({ error: 'nonce and amount are required' }, { status: 400 });
        }

        if (billingAgreementId) {
            // --- GraphQL path (paypal_au merchant account) ---

            // Step 1: Create customer
            const customerData = await braintreeGraphql(CREATE_CUSTOMER, { input: { customer: {} } });
            if (customerData.errors?.length) {
                return json({ error: customerData.errors.map(e => e.message).join('; ') }, { status: 400 });
            }
            const customerId = customerData.data?.createCustomer?.customer?.id;

            // Step 2: Vault the billing agreement via the AU merchant account
            const vaultData = await braintreeGraphql(VAULT_BILLING_AGREEMENT, {
                input: {
                    billingAgreementId,
                    ...(customerId ? { customerId } : {}),
                    merchantAccountId: MERCHANT_ACCOUNT_ID,
                },
            });
            if (vaultData.errors?.length) {
                return json({ error: vaultData.errors.map(e => e.message).join('; '), details: vaultData.errors }, { status: 400 });
            }
            const paymentMethod = vaultData.data?.vaultPayPalBillingAgreement?.paymentMethod;
            if (!paymentMethod) {
                return json({ error: 'No payment method returned from vault', details: vaultData }, { status: 400 });
            }

            // Step 3: Charge via the vaulted payment method
            const chargeData = await braintreeGraphql(CHARGE_PAYMENT_METHOD, {
                input: {
                    paymentMethodId: paymentMethod.id,
                    transaction: {
                        amount,
                        merchantAccountId: MERCHANT_ACCOUNT_ID,
                    },
                },
            });
            if (chargeData.errors?.length) {
                return json({ error: chargeData.errors.map(e => e.message).join('; '), details: chargeData.errors }, { status: 400 });
            }
            const tx = chargeData.data?.chargePaymentMethod?.transaction;
            if (!tx) {
                return json({ error: 'No transaction returned', details: chargeData }, { status: 400 });
            }

            return json({
                success: true,
                transactionId: tx.legacyId,
                status: tx.status,
                customerId: customerData.data?.createCustomer?.customer?.legacyId ?? null,
                savedPaymentMethodToken: paymentMethod.legacyId,
            });
        }

        // --- Node SDK fallback (no billingAgreementId in tokenize details) ---
        // Note: this path will fail if the gateway default PayPal link does not
        // have Reference Transactions — included for diagnostics only.
        const customerResult = await gateway.customer.create({});
        if (!customerResult.success) {
            return json({ error: `Failed to create customer: ${customerResult.message}` }, { status: 400 });
        }
        const customerId = customerResult.customer.id;

        const vaultResult = await gateway.paymentMethod.create({
            customerId,
            paymentMethodNonce: nonce,
        });
        if (!vaultResult.success) {
            return json({ error: `Failed to vault payment method: ${vaultResult.message}` }, { status: 400 });
        }
        const savedPaymentMethodToken = vaultResult.paymentMethod.token;

        const saleResult = await gateway.transaction.sale({
            amount,
            paymentMethodToken: savedPaymentMethodToken,
            merchantAccountId: MERCHANT_ACCOUNT_ID,
            options: { submitForSettlement: true },
        });
        if (!saleResult.success) {
            return json({ error: saleResult.message }, { status: 400 });
        }

        return json({
            success: true,
            transactionId: saleResult.transaction.id,
            status: saleResult.transaction.status,
            customerId,
            savedPaymentMethodToken,
        });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
}

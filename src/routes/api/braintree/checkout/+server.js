import { json } from '@sveltejs/kit';
import { braintreeGraphql } from '$lib/server/braintree.js';

// For initial checkout charges (nonce from client SDK)
const CHARGE_PAYPAL_MUTATION = `
mutation ChargePayPalAccount($input: ChargePayPalAccountInput!) {
  chargePayPalAccount(input: $input) {
    transaction {
      id
      legacyId
      status
      amount {
        value
        currencyCode
      }
      customer {
        id
        paymentMethods(first: 1) {
          edges {
            node {
              id
              legacyId
            }
          }
        }
      }
      paymentMethodSnapshot {
        ... on PayPalTransactionDetails {
          captureId
          payerStatus
          sellerProtectionStatus
          payer {
            payerId
            email
          }
        }
      }
      shipping {
        shippingAmount
        shippingAddress {
          addressLine1
          addressLine2
          adminArea1
          adminArea2
          postalCode
          countryCode
        }
      }
    }
  }
}`;


const VAULT_MUTATION = `
mutation VaultPaymentMethod($input: VaultPaymentMethodInput!) {
  vaultPaymentMethod(input: $input) {
    paymentMethod {
      id
      legacyId
      details {
        ... on PayPalAccountDetails {
          email
          payerId
        }
      }
    }
  }
}`;

const FAILED_STATUSES = new Set([
    'PROCESSOR_DECLINED',
    'GATEWAY_REJECTED',
    'FAILED',
    'AUTHORIZATION_EXPIRED',
    'SETTLEMENT_DECLINED',
]);

function extractPayPalTransaction(data) {
    const tx = data.data?.chargePayPalAccount?.transaction;
    if (!tx) return {};
    const vaultedPm = tx.customer?.paymentMethods?.edges?.[0]?.node;
    const snapshot = tx.paymentMethodSnapshot;
    return {
        transactionId: tx.legacyId || tx.id || null,
        status: tx.status || null,
        vaultToken: vaultedPm?.legacyId || null,
        vaultPaymentMethodId: vaultedPm?.id || null,
        payerId: snapshot?.payer?.payerId || null,
        captureId: snapshot?.captureId || null,
        payerStatus: snapshot?.payerStatus || null,
        sellerProtectionStatus: snapshot?.sellerProtectionStatus || null,
        failed: FAILED_STATUSES.has(tx.status),
    };
}


export async function POST({ request }) {
    try {
        const { nonce, isVault, amount, type, paymentMethodToken, paymentMethodId, createCustomer } = await request.json();

        const mutations = [];

        if ((type === 'paymentMethodToken' && paymentMethodToken) || (type === 'paymentMethodId' && paymentMethodId)) {
            // Charge via vaulted payment method
            const input = {
                paymentMethodId: paymentMethodId || paymentMethodToken,
                transaction: { amount: amount || '10.00' },
            };

            const data = await braintreeGraphql(CHARGE_PAYPAL_MUTATION, { input });
            mutations.push({ mutation: 'chargePayPalAccount', request: input, response: data });

            if (data.errors?.length) {
                const errorMessage = data.errors.map(e => e.message).join('; ');
                return json({ success: false, error: errorMessage, mutations }, { status: 400 });
            }

            const txResult = extractPayPalTransaction(data);
            if (txResult.failed) {
                return json({ success: false, error: `Transaction ${txResult.status}: ${txResult.transactionId}`, ...txResult, mutations }, { status: 400 });
            }

            return json({ success: true, ...txResult, mutations });

        } else if (createCustomer || (isVault && amount === '0.00')) {
            // Vault-only ($0 auth) — vault the nonce without charging
            const input = { paymentMethodId: nonce };

            const data = await braintreeGraphql(VAULT_MUTATION, { input });
            mutations.push({ mutation: 'vaultPaymentMethod', request: input, response: data });

            if (data.errors?.length) {
                const errorMessage = data.errors.map(e => e.message).join('; ');
                return json({ success: false, error: errorMessage, mutations }, { status: 400 });
            }

            const pm = data.data?.vaultPaymentMethod?.paymentMethod;
            return json({
                success: true,
                transactionId: null,
                vaultToken: pm?.legacyId || null,
                payerId: pm?.details?.payerId || null,
                mutations,
            });

        } else {
            // Standard sale — optionally vault after transacting (recurring flow)
            // Uses chargePayPalAccount for initial checkout with nonce
            const input = {
                paymentMethodId: nonce,
                transaction: { amount: amount || '10.00' },
            };

            if (isVault) {
                input.transaction.vaultPaymentMethodAfterTransacting = { when: 'ON_SUCCESSFUL_TRANSACTION' };
            }

            const data = await braintreeGraphql(CHARGE_PAYPAL_MUTATION, { input });
            mutations.push({ mutation: 'chargePayPalAccount', request: input, response: data });

            if (data.errors?.length) {
                const errorMessage = data.errors.map(e => e.message).join('; ');
                return json({ success: false, error: errorMessage, mutations }, { status: 400 });
            }

            const txResult = extractPayPalTransaction(data);
            if (txResult.failed) {
                return json({ success: false, error: `Transaction ${txResult.status}: ${txResult.transactionId}`, ...txResult, mutations }, { status: 400 });
            }

            return json({ success: true, ...txResult, mutations });
        }
    } catch (error) {
        console.error('Transaction error:', error);
        return json({ error: 'Failed to process transaction' }, { status: 500 });
    }
}

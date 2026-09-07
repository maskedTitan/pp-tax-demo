import { json } from '@sveltejs/kit';
import { braintreeGraphql } from '$lib/server/braintree.js';

const CHARGE_MUTATION = `
mutation ChargePaymentMethod($input: ChargePaymentMethodInput!) {
  chargePaymentMethod(input: $input) {
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
          payer {
            payerId
            email
          }
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

function extractTransaction(data) {
    const tx = data.data?.chargePaymentMethod?.transaction;
    if (!tx) return {};
    const vaultedPm = tx.customer?.paymentMethods?.edges?.[0]?.node;
    return {
        transactionId: tx.legacyId || tx.id || null,
        vaultToken: vaultedPm?.legacyId || null,
        vaultPaymentMethodId: vaultedPm?.id || null,
        payerId: tx.paymentMethodSnapshot?.payer?.payerId || null,
    };
}

export async function POST({ request }) {
    try {
        const { nonce, isVault, amount, type, paymentMethodToken, paymentMethodId, createCustomer } = await request.json();

        const mutations = [];

        if ((type === 'paymentMethodToken' && paymentMethodToken) || (type === 'paymentMethodId' && paymentMethodId)) {
            // Charge via vaulted payment method (GraphQL ID or legacy token)
            const input = {
                paymentMethodId: paymentMethodId || paymentMethodToken,
                transaction: { amount: amount || '10.00' },
            };

            const data = await braintreeGraphql(CHARGE_MUTATION, { input });
            mutations.push({ mutation: 'chargePaymentMethod', request: input, response: data });

            if (data.errors?.length) {
                const errorMessage = data.errors.map(e => e.message).join('; ');
                return json({ success: false, error: errorMessage, mutations }, { status: 400 });
            }

            return json({ success: true, ...extractTransaction(data), mutations });

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
            const input = {
                paymentMethodId: nonce,
                transaction: { amount: amount || '10.00' },
            };

            if (isVault) {
                input.transaction.vaultPaymentMethodAfterTransacting = { when: 'ON_SUCCESSFUL_TRANSACTION' };
            }

            const data = await braintreeGraphql(CHARGE_MUTATION, { input });
            mutations.push({ mutation: 'chargePaymentMethod', request: input, response: data });

            if (data.errors?.length) {
                const errorMessage = data.errors.map(e => e.message).join('; ');
                return json({ success: false, error: errorMessage, mutations }, { status: 400 });
            }

            return json({ success: true, ...extractTransaction(data), mutations });
        }
    } catch (error) {
        console.error('Transaction error:', error);
        return json({ error: 'Failed to process transaction' }, { status: 500 });
    }
}

# Checkout Session Expiry Implementation

This document describes the session timeout feature for Adyen PayPal checkout, which automatically expires checkout sessions after a configurable duration for security purposes.

## Overview

The session expiry feature:
- Starts a timer when the user clicks the PayPal button (not on page load)
- Validates the session both client-side and server-side
- Displays a clean UI when the session expires with the PayPal order ID
- Prevents stale payment sessions from being completed

---

## Configuration

```javascript
// Session timeout configuration
const PRODUCTION_TIMEOUT_MINUTES = 60;  // 60 minutes for production
const TEST_TIMEOUT_MINUTES = 0.5;       // 30 seconds for testing

// Feature toggles
let enableSessionTimeout = true;
let useTestTimeout = false;  // Toggle for development testing

// Computed timeout value
$: timeoutMinutes = useTestTimeout ? TEST_TIMEOUT_MINUTES : PRODUCTION_TIMEOUT_MINUTES;
$: timeoutMs = timeoutMinutes * 60 * 1000;
```

---

## Client-Side Implementation

### State Variables

```javascript
let sessionStartTime = null;      // Timestamp when checkout began
let sessionExpired = false;       // Whether the session has expired
let sessionTimeoutId = null;      // Timeout ID for cleanup
let countdownIntervalId = null;   // Interval ID for countdown
let remainingTime = null;         // Remaining seconds (for UI if needed)
let showTimeoutWarning = false;   // Show warning before expiry
let paypalOrderId = null;         // PayPal order ID for logging
```

### Starting the Timer

Start the timer when the user clicks the PayPal button (`onSubmit`), not on page load:

```javascript
paypalConfig.onSubmit = async (state, component) => {
    console.log("[PayPal] onSubmit");
    component.setStatus("loading");

    // Start session timer when checkout begins
    if (enableSessionTimeout && !sessionStartTime) {
        startSessionTimer();
    }
    
    // Continue with payment processing...
};
```

### Timer Functions

```javascript
function startSessionTimer() {
    clearSessionTimer(); // Clear any existing timer
    
    sessionStartTime = Date.now();
    sessionExpired = false;
    showTimeoutWarning = false;
    remainingTime = Math.floor(timeoutMs / 1000);

    // Set up the expiration timeout
    sessionTimeoutId = setTimeout(() => {
        handleSessionExpired();
    }, timeoutMs);

    // Optional: Set up countdown interval for UI updates
    countdownIntervalId = setInterval(() => {
        if (sessionStartTime) {
            const elapsed = Date.now() - sessionStartTime;
            remainingTime = Math.max(0, Math.floor((timeoutMs - elapsed) / 1000));

            // Show warning when approaching timeout (e.g., 2 minutes before)
            const warningThresholdMs = 2 * 60 * 1000;
            if (elapsed >= timeoutMs - warningThresholdMs && !showTimeoutWarning) {
                showTimeoutWarning = true;
            }
        }
    }, 1000);
}

function clearSessionTimer() {
    if (sessionTimeoutId) {
        clearTimeout(sessionTimeoutId);
        sessionTimeoutId = null;
    }
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }
}
```

### Handling Session Expiry

```javascript
function handleSessionExpired() {
    sessionExpired = true;
    showTimeoutWarning = false;
    remainingTime = 0;
    clearSessionTimer();

    // Format timeout for logging
    const timeoutDisplay = timeoutMinutes < 1
        ? `${Math.round(timeoutMinutes * 60)} seconds`
        : `${timeoutMinutes} minutes`;

    console.log(
        `[Session Expired] Order: ${paypalOrderId || "N/A"}, Duration: ${timeoutDisplay}`
    );

    // Unmount the PayPal component to prevent further interaction
    if (paypalComponent) {
        try {
            paypalComponent.unmount();
        } catch (e) {
            // Handle unmount error silently
        }
    }
}
```

### Pre-Submit Validation

Check session validity before completing payment in `onAdditionalDetails`:

```javascript
paypalConfig.onAdditionalDetails = async (state, component) => {
    console.log("[PayPal] onAdditionalDetails");
    component.setStatus("loading");

    // Check client-side if session has expired
    if (enableSessionTimeout && sessionStartTime) {
        const elapsed = Date.now() - sessionStartTime;
        if (elapsed > timeoutMs) {
            handleSessionExpired();
            component.setStatus("ready");
            return;
        }
    }

    // Continue with payment details submission...
    const response = await fetch("/api/payments/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            data: state.data,
            // Include session info for server-side validation
            checkoutStartTime: sessionStartTime,
            timeoutMinutes: timeoutMinutes,
        }),
    });

    const result = await response.json();

    // Handle server-side session expiry
    if (result.resultCode === "SESSION_EXPIRED") {
        handleSessionExpired();
        component.setStatus("ready");
        return;
    }

    // Handle success or other responses...
};
```

### Capturing PayPal Order ID

Capture the order ID for logging purposes:

```javascript
// From action response in onSubmit
if (result.action) {
    const orderId = result.action.sdkData?.token || result.action.sdkData?.orderID;
    if (orderId && !paypalOrderId) {
        paypalOrderId = orderId;
    }
}

// From onShippingAddressChange (if shipping is enabled)
paypalConfig.onShippingAddressChange = async (data, actions) => {
    if (data.orderID) {
        paypalOrderId = data.orderID;
    }
    // Continue handling...
};

// From onAdditionalDetails
if (state.data?.details?.orderID && !paypalOrderId) {
    paypalOrderId = state.data.details.orderID;
}
```

### Reset Session

```javascript
function resetSession() {
    sessionExpired = false;
    showTimeoutWarning = false;
    sessionStartTime = null;
    remainingTime = null;
    paypalOrderId = null;
    
    // Re-initialize the PayPal component
    initializePayPal();
}
```

---

## Server-Side Implementation

Add validation to your payment details endpoint:

```javascript
// /api/payments/details/+server.js (SvelteKit example)

export async function POST({ request }) {
    const body = await request.json();
    const { data, checkoutStartTime, timeoutMinutes } = body;

    // Validate session timeout
    if (checkoutStartTime && timeoutMinutes) {
        const elapsedMs = Date.now() - checkoutStartTime;
        const timeoutMs = timeoutMinutes * 60 * 1000;

        if (elapsedMs > timeoutMs) {
            console.log(`[Session] REJECTED - Elapsed: ${Math.floor(elapsedMs / 1000)}s`);

            return Response.json({
                error: "Checkout session expired",
                resultCode: "SESSION_EXPIRED",
                message: `Session expired after ${timeoutMinutes} minutes`,
            }, { status: 400 });
        }
    }

    // Continue with Adyen payment details call...
    const adyenResponse = await submitPaymentDetails(data);
    return Response.json(adyenResponse);
}
```

---

## UI Implementation

Simple session expired UI (Svelte example):

```svelte
{#if sessionExpired}
    <div class="p-5 bg-white rounded-lg border border-gray-200">
        <p class="text-gray-700 mb-2">
            <span class="font-medium">Session timed out</span>
        </p>
        {#if paypalOrderId}
            <p class="text-sm text-gray-500 mb-4">
                Order ID: <span class="font-mono">{paypalOrderId}</span>
            </p>
        {/if}
        <button
            onclick={resetSession}
            class="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-800"
        >
            Restart Checkout
        </button>
    </div>
{:else}
    <!-- PayPal button container -->
    <div id="paypal-button-container"></div>
{/if}
```

---

## Console Logging

The implementation includes minimal logging for each PayPal hook:

```
[PayPal] onSubmit
[PayPal] onShippingAddressChange
[PayPal] onShippingOptionsChange
[PayPal] onAdditionalDetails
[PayPal] onCancel
[PayPal] onError
[Session Expired] Order: 91W38232877453546, Duration: 30 seconds
```

---

## Key Points

1. **Timer starts on user action**: The timer begins when the user clicks the PayPal button, not on page load. This gives users the full timeout duration for their active checkout.

2. **Dual validation**: Both client-side and server-side validation ensures security even if the client is manipulated.

3. **Graceful cleanup**: The PayPal component is unmounted when the session expires to prevent further interaction.

4. **Order ID tracking**: The PayPal order ID is captured and logged for debugging and reconciliation.

5. **Configurable timeouts**: Easy to switch between production (60 min) and test (30 sec) timeouts.

---

## Security Considerations

- Server-side validation is the authoritative check - client-side is for UX only
- Always validate `checkoutStartTime` comes from a trusted source in production
- Consider adding additional validation (e.g., signed timestamps) for high-security applications
- Clear all session state on timeout to prevent data leakage

# Session Expiry – Core Implementation

## Config

```javascript
const TIMEOUT_SECONDS = 30;
let enableSessionTimeout = true;

$: timeoutMs = TIMEOUT_SECONDS * 1000;
```

## State

```javascript
let sessionStartTime = null;
let sessionExpired = false;
let sessionTimeoutId = null;
let paypalOrderId = null;
```

## Start timer on PayPal button click (onSubmit)

```javascript
paypalConfig.onSubmit = async (state, component) => {
    console.log("[PayPal] onSubmit");
    component.setStatus("loading");
    
    if (enableSessionTimeout && !sessionStartTime) {
        startSessionTimer();
    }
    // ...payment processing
};
```

## Timer logic

```javascript
function startSessionTimer() {
    clearSessionTimer();
    sessionStartTime = Date.now();
    sessionExpired = false;

    sessionTimeoutId = setTimeout(() => {
        handleSessionExpired();
    }, timeoutMs);
}

function handleSessionExpired() {
    sessionExpired = true;
    clearSessionTimer();
    console.log(`[Session Expired] Order: ${paypalOrderId || "N/A"}, Duration: ${TIMEOUT_SECONDS}s`);

    if (paypalComponent) {
        try { paypalComponent.unmount(); } catch (e) {}
    }
}

function clearSessionTimer() {
    if (sessionTimeoutId) {
        clearTimeout(sessionTimeoutId);
        sessionTimeoutId = null;
    }
}
```

## Block payment if expired (onAdditionalDetails)

```javascript
paypalConfig.onAdditionalDetails = async (state, component) => {
    console.log("[PayPal] onAdditionalDetails");
    component.setStatus("loading");

    // Client-side check
    if (enableSessionTimeout && sessionStartTime) {
        const elapsed = Date.now() - sessionStartTime;
        if (elapsed > timeoutMs) {
            handleSessionExpired();
            component.setStatus("ready");
            return;
        }
    }

    const response = await fetch("/api/adyen/payments/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            data: state.data,
            checkoutStartTime: sessionStartTime,
            timeoutMinutes: enableSessionTimeout ? TIMEOUT_SECONDS / 60 : null,
        }),
    });

    const result = await response.json();
    
    if (result.resultCode === "SESSION_EXPIRED") {
        handleSessionExpired();
        component.setStatus("ready");
        return;
    }
};
```

## Server-side validation

```javascript
export async function POST({ request }) {
    const { data, checkoutStartTime, timeoutMinutes } = await request.json();

    if (checkoutStartTime && timeoutMinutes) {
        const elapsed = Date.now() - checkoutStartTime;
        const timeoutMs = timeoutMinutes * 60 * 1000;

        if (elapsed > timeoutMs) {
            return json({
                resultCode: "SESSION_EXPIRED",
                error: "Checkout session expired",
            }, { status: 400 });
        }
    }

    const response = await adyenRequest('/payments/details', data);
    return json(response);
}
```

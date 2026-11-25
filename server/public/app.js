
"use strict";

/*
 * CallVerify website controller
 *
 * Preparation window: 90 seconds
 * Call window:        30 seconds
 *
 * The backend is authoritative for session status and expiry.
 */

const PREPARATION_WINDOW_SECONDS = 90;
const CALL_WINDOW_SECONDS = 30;
const STATUS_POLL_INTERVAL_MS = 1000;
const COUNTDOWN_INTERVAL_MS = 500;

const form = document.getElementById("verifyForm");
const phoneInput = document.getElementById("phoneNumber");
const verifyButton = document.getElementById("verifyButton");

const callPanel = document.getElementById("callPanel");
const dialNumber = document.getElementById("dialNumber");
const copyButton = document.getElementById("copyButton");
const countdown = document.getElementById("countdown");
const countdownLabel = document.getElementById("countdownLabel");

const callStatus = document.getElementById("callStatus");
const callStatusText = document.getElementById("callStatusText");

const result = document.getElementById("result");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");
const retryButton = document.getElementById("retryButton");

let currentSessionId = null;
let expiresAt = null;

let pollingTimer = null;
let countdownTimer = null;

let verificationFinished = false;
let callStarted = false;
let callButton = null;
let statusCheckInFlight = false;


/* ---------------------------------------------------------
   RESULT MESSAGE
--------------------------------------------------------- */

function showResult(title, message, type = "") {
    result.classList.remove("hidden", "success", "error");

    if (type) {
        result.classList.add(type);
    }

    resultTitle.textContent = title;
    resultMessage.textContent = message;
}

function hideResult() {
    result.classList.add("hidden");
}


/* ---------------------------------------------------------
   TIMERS
--------------------------------------------------------- */

function stopTimers() {
    if (pollingTimer !== null) {
        clearInterval(pollingTimer);
        pollingTimer = null;
    }

    if (countdownTimer !== null) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

function startCountdownTimer() {
    if (countdownTimer !== null) {
        clearInterval(countdownTimer);
    }

    countdownTimer = setInterval(
        updateCountdown,
        COUNTDOWN_INTERVAL_MS
    );
}

function startStatusPolling() {
    if (pollingTimer !== null) {
        clearInterval(pollingTimer);
    }

    pollingTimer = setInterval(
        checkVerification,
        STATUS_POLL_INTERVAL_MS
    );
}


/* ---------------------------------------------------------
   CALL STATUS
--------------------------------------------------------- */

function setCallStatus(text, state = "") {
    callStatusText.textContent = text;

    callStatus.classList.remove(
        "verified",
        "expired"
    );

    if (state) {
        callStatus.classList.add(state);
    }
}


/* ---------------------------------------------------------
   TIME FORMATTING
--------------------------------------------------------- */

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(remainingSeconds).padStart(2, "0")
    );
}


/* ---------------------------------------------------------
   CALL BUTTON
--------------------------------------------------------- */

function removeCallButton() {
    if (callButton) {
        callButton.remove();
        callButton = null;
    }
}

function createCallButton() {
    removeCallButton();

    callButton = document.createElement("button");

    callButton.type = "button";
    callButton.id = "callNowButton";
    callButton.className = "primary-button";
    callButton.textContent = "Call to Verify";

    callButton.addEventListener(
        "click",
        startCallVerification
    );

    callPanel.appendChild(callButton);
}


/* ---------------------------------------------------------
   RESET
--------------------------------------------------------- */

function resetVerification() {
    stopTimers();

    currentSessionId = null;
    expiresAt = null;

    verificationFinished = false;
    callStarted = false;
    statusCheckInFlight = false;

    removeCallButton();

    callPanel.classList.add("hidden");
    retryButton.classList.add("hidden");

    hideResult();

    verifyButton.disabled = false;
    verifyButton.textContent = "Verify my number";

    copyButton.textContent = "Copy number";

    countdownLabel.textContent = "Time to start your call";

    countdown.textContent = formatTime(
        PREPARATION_WINDOW_SECONDS
    );

    setCallStatus("Waiting for your call");
}


/* ---------------------------------------------------------
   FINISH SESSION
--------------------------------------------------------- */

function finishVerification(status) {
    if (verificationFinished) {
        return;
    }

    verificationFinished = true;

    stopTimers();
    removeCallButton();

    if (status === "verified") {
        countdownLabel.textContent = "Session status";
        countdown.textContent = "Completed";

        setCallStatus(
            "Number verified",
            "verified"
        );

        verifyButton.disabled = false;
        verifyButton.textContent = "Verify another number";

        showResult(
            "Number verified",
            "Your incoming call was detected and your caller number matched.",
            "success"
        );

        retryButton.classList.add("hidden");

        return;
    }

    countdownLabel.textContent = "Session status";
    countdown.textContent = "Expired";

    setCallStatus(
        "Session expired",
        "expired"
    );

    verifyButton.disabled = false;
    verifyButton.textContent = "Verify my number";

    showResult(
        "Call not detected",
        "Your verification window has ended. Start a new attempt to try again.",
        "error"
    );

    retryButton.classList.remove("hidden");
}


/* ---------------------------------------------------------
   COUNTDOWN
--------------------------------------------------------- */

function updateCountdown() {
    if (
        expiresAt === null ||
        verificationFinished
    ) {
        return;
    }

    const remaining = Math.max(
        0,
        Math.ceil(
            (expiresAt - Date.now()) / 1000
        )
    );

    countdown.textContent = formatTime(remaining);

    if (remaining <= 0) {
        finishVerification("expired");
    }
}


/* ---------------------------------------------------------
   CHECK BACKEND STATUS
--------------------------------------------------------- */

async function checkVerification() {
    if (
        !currentSessionId ||
        verificationFinished ||
        statusCheckInFlight
    ) {
        return;
    }

    statusCheckInFlight = true;

    try {
        const response = await fetch(
            `/web/verifications/${encodeURIComponent(currentSessionId)}`,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error(
                "Verification status error:",
                data
            );

            return;
        }

        /*
         * Always use the backend expiry timestamp
         * when it is available.
         */
        if (data.expiresAt) {
            const serverExpiry = Number(
                data.expiresAt
            );

            if (Number.isFinite(serverExpiry)) {
                expiresAt = serverExpiry;
            }
        }

        if (data.status === "verified") {
            finishVerification("verified");

        } else if (data.status === "expired") {
            finishVerification("expired");
        }

    } catch (error) {
        console.error(
            "Status check failed:",
            error
        );

    } finally {
        statusCheckInFlight = false;
    }
}


/* ---------------------------------------------------------
   START CALL VERIFICATION
--------------------------------------------------------- */

async function startCallVerification() {
    if (
        !currentSessionId ||
        callStarted ||
        verificationFinished
    ) {
        return;
    }

    callStarted = true;

    callButton.disabled = true;
    callButton.textContent = "Starting call window...";

    countdownLabel.textContent = "Call window ends in";

    setCallStatus("Starting call window");

    /*
     * Start a provisional local countdown immediately.
     * The backend expiry timestamp will replace it.
     */
    expiresAt = Date.now() +
        CALL_WINDOW_SECONDS * 1000;

    updateCountdown();
    startCountdownTimer();
    startStatusPolling();

    showResult(
        "Starting call",
        "Your 30-second call window is starting. Call the verification number now."
    );

    /*
     * IMPORTANT:
     * Initiate the backend request directly from the click.
     * Do not await it before opening the phone dialler.
     */
    const startRequest = fetch(
        `/web/verifications/${encodeURIComponent(currentSessionId)}/start-call`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({})
        }
    );

    /*
     * Open the dialler immediately while the browser
     * still recognises the user's click.
     */
    const number = dialNumber.textContent.trim();

    window.location.href =
        "tel:" + number.replace(/[^\d+]/g, "");

    /*
     * Process the backend response after triggering
     * the dialler.
     */
    try {
        const response = await startRequest;
        const data = await response.json();

        if (!response.ok) {
            if (
                data.error === "session_expired" ||
                data.status === "expired"
            ) {
                finishVerification("expired");
                return;
            }

            callStarted = false;

            callButton.disabled = false;
            callButton.textContent = "Call to Verify";

            countdownLabel.textContent =
                "Time to start your call";

            showResult(
                "Could not start call window",
                data.message ||
                    data.error ||
                    "Please try again.",
                "error"
            );

            return;
        }

        /*
         * Synchronise the countdown with the
         * backend's authoritative expiry timestamp.
         */
        if (data.expiresAt) {
            const serverExpiry = Number(
                data.expiresAt
            );

            if (Number.isFinite(serverExpiry)) {
                expiresAt = serverExpiry;
            }
        }

        callButton.textContent =
            "Call window active";

        setCallStatus("Call the number now");

        updateCountdown();

        /*
         * Check immediately in case the call was
         * detected before this response arrived.
         */
        await checkVerification();

    } catch (error) {
        /*
         * Do not pretend the backend timer was
         * successfully confirmed.
         *
         * Keep polling because the request may
         * have reached the server despite a
         * temporary browser network error.
         */
        console.error(
            "Start call request failed:",
            error
        );

        showResult(
            "Timer confirmation pending",
            "We could not confirm the call window yet. Return to this page and check your verification status.",
            "error"
        );
    }
}


/* ---------------------------------------------------------
   CREATE VERIFICATION SESSION
--------------------------------------------------------- */

form.addEventListener(
    "submit",
    async function (event) {
        event.preventDefault();

        if (verifyButton.disabled) {
            return;
        }

        resetVerification();

        const phoneNumber = phoneInput.value.trim();

        if (!phoneNumber) {
            showResult(
                "Phone number required",
                "Enter the phone number you want to verify.",
                "error"
            );

            phoneInput.focus();
            return;
        }

        verifyButton.disabled = true;
        verifyButton.textContent = "Creating session...";

        showResult(
            "Starting verification",
            "Please wait while we create your session."
        );

        try {
            const response = await fetch(
                "/web/verifications",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        phoneNumber: phoneNumber
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                verifyButton.disabled = false;
                verifyButton.textContent =
                    "Verify my number";

                showResult(
                    "Could not start verification",
                    data.message ||
                        data.error ||
                        "Please try again.",
                    "error"
                );

                return;
            }

            if (
                !data.id ||
                !data.dialNumber ||
                !data.expiresAt
            ) {
                verifyButton.disabled = false;
                verifyButton.textContent =
                    "Verify my number";

                showResult(
                    "Configuration issue",
                    "The server returned an incomplete verification session.",
                    "error"
                );

                return;
            }

            currentSessionId = data.id;
            expiresAt = Number(data.expiresAt);

            if (!Number.isFinite(expiresAt)) {
                resetVerification();

                showResult(
                    "Configuration issue",
                    "The server returned an invalid session expiry time.",
                    "error"
                );

                return;
            }

            dialNumber.textContent =
                data.dialNumber;

            callPanel.classList.remove("hidden");

            countdownLabel.textContent =
                "Time to start your call";

            setCallStatus("Ready to call");

            verifyButton.textContent =
                "Verification in progress";

            createCallButton();

            showResult(
                "Session ready",
                "When you are ready, tap Call to Verify. Your 30-second call window starts at that point."
            );

            /*
             * Start the 90-second preparation
             * countdown immediately.
             */
            updateCountdown();
            startCountdownTimer();

            /*
             * Poll the backend for verification
             * and expiry.
             */
            startStatusPolling();

            await checkVerification();

        } catch (error) {
            console.error(
                "Create session failed:",
                error
            );

            verifyButton.disabled = false;
            verifyButton.textContent =
                "Verify my number";

            showResult(
                "Connection error",
                "Unable to connect to CallVerify. Please try again.",
                "error"
            );
        }
    }
);


/* ---------------------------------------------------------
   COPY VERIFICATION NUMBER
--------------------------------------------------------- */

copyButton.addEventListener(
    "click",
    async function () {
        const number = dialNumber.textContent.trim();

        try {
            await navigator.clipboard.writeText(number);

            copyButton.textContent =
                "Number copied";

            setTimeout(function () {
                copyButton.textContent =
                    "Copy number";
            }, 2000);

        } catch (error) {
            showResult(
                "Copy unavailable",
                "Please select and copy the number manually."
            );
        }
    }
);


/* ---------------------------------------------------------
   RETRY
--------------------------------------------------------- */

retryButton.addEventListener(
    "click",
    function () {
        resetVerification();
        phoneInput.focus();
    }
);

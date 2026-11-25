# CallVerify

**API-first phone-call verification platform**

CallVerify is a phone verification system that uses a real incoming phone call to a dedicated Android receiver device.

Instead of sending an SMS OTP, a user initiates a verification session from a website or application and places a call to the CallVerify receiver number. The receiver detects the incoming call and reports the event to the CallVerify backend. The backend checks whether the event matches an active verification session and returns the result to the requesting application.

The project is designed to become a reusable verification service that other websites, applications, fintechs, and businesses can integrate through an API.

---

## 1. How CallVerify Works

The intended verification flow is:

1. A website or application submits a phone number to the CallVerify API.
2. The backend creates a short-lived verification session.
3. The user sees a **Call to Verify** button.
4. The user places a call to the dedicated CallVerify receiver number.
5. The Android receiver detects the incoming call.
6. The receiver sends a call event to the backend.
7. The backend checks the active verification session.
8. The requesting application polls the session or receives its result.
9. The verification result is returned to the application.

### System architecture

```text
Website / Mobile App
        |
        | Create verification session
        v
CallVerify API (Node.js / Express)
        |
        | Active session
        v
Dedicated Android Receiver
        |
        | Incoming call detected
        v
Call Screening Service
        |
        | Device event
        v
CallVerify API
        |
        | Match session and event
        v
Verification Result
        |
        v
Website / Mobile App
```

---

## 2. Project Structure

The repository contains the backend and Android receiver.

```text
Call_Verify/
│
├── server/
│   ├── src/
│   │   └── server.js
│   │
│   ├── public/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│   │
│   ├── .env.example
│   ├── package.json
│   └── package-lock.json
│
├── android/
│   └── CallVerifyReceiver/
│       ├── app/
│       │   └── src/
│       │       └── main/
│       │           ├── java/
│       │           │   └── com/callverify/receiver/
│       │           │       └── CallVerifyScreeningService.java
│       │           ├── AndroidManifest.xml
│       │           └── res/
│       │
│       ├── build.gradle.kts
│       └── settings.gradle.kts
│
├── .gitattributes
├── .gitignore
└── README.md
```

### What each part does

| Component | Purpose |
|---|---|
| `server/src/server.js` | Runs the backend API and manages verification sessions |
| `server/public/` | Contains the browser-based verification interface |
| `server/.env.example` | Shows the environment variables required to run the backend |
| `android/CallVerifyReceiver/` | Android Studio project for the dedicated receiver phone |
| `CallVerifyScreeningService.java` | Detects and processes incoming call-screening events |
| `AndroidManifest.xml` | Declares Android application components and permissions |
| `package.json` | Defines Node.js dependencies and server commands |

---

## 3. Technology Stack

### Backend

- Node.js
- Express
- REST API
- Environment-based configuration

### Frontend

- HTML
- CSS
- JavaScript

### Android Receiver

- Android Studio
- Kotlin / Java Android components
- Android call-screening APIs

### Planned production infrastructure

- PostgreSQL for persistent verification sessions
- Redis or database locking for concurrency control
- HTTPS for secure communication
- Monitoring and audit logging

---

## 4. Getting Started

Follow these steps to run the project locally.

### Requirements

Install the following tools:

- Node.js LTS
- npm
- Android Studio
- Git
- GitHub Desktop

The Android receiver must be tested on a supported Android device. Android Studio's emulator may not reproduce real incoming-call behavior.

---

## 5. Start the Backend

Open PowerShell and navigate to the server directory.

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\GitHub\Call_Verify\server"
```

Install dependencies:

```powershell
npm install
```

Create your local environment file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and configure the required values.

Example:

```env
PORT=3000
API_KEY=your_backend_api_secret
DEVICE_KEY=your_receiver_device_secret
PUBLIC_DIAL_NUMBER=+234XXXXXXXXXX
```

Use separate, randomly generated secrets for `API_KEY` and `DEVICE_KEY`.

Do not use example values in production.

Start the backend:

```powershell
npm start
```

Expected output:

```text
CallVerify API listening on :3000
```

The backend is now running locally.

---

## 6. Open the Verification Website

With the backend running, open:

```text
http://localhost:3000
```

The website is served from the backend's `public` directory.

The website provides the interface for initiating and completing a verification session.

---

## 7. Test the API

### Check backend health

```powershell
curl.exe http://localhost:3000/v1/health
```

### Create a verification session

```powershell
curl.exe -X POST http://localhost:3000/v1/verifications `
  -H "Authorization: Bearer YOUR_API_KEY" `
  -H "Content-Type: application/json" `
  -d '{"reference":"demo-001"}'
```

The response should contain a verification session identifier.

Save this identifier for the next request.

### Send a test device event

```powershell
curl.exe -X POST http://localhost:3000/v1/device/events `
  -H "Authorization: Bearer YOUR_DEVICE_KEY" `
  -H "Content-Type: application/json" `
  -d '{"type":"incoming_call_ringing"}'
```

This simulates an incoming-call event.

It does not place a real telephone call.

### Check the verification result

Use the session identifier returned when creating the verification session and poll the session-status endpoint documented by the backend.

---

## 8. Android Receiver Setup

The Android receiver is intended to run on a dedicated Android phone with a SIM card and a reachable phone number.

The receiver's responsibilities are:

1. Detect an incoming call.
2. Identify the available caller information.
3. Report the call event to the backend.
4. Receive the backend's decision.
5. Reject the call when the configured verification flow requires it.

### Open the Android project

1. Open Android Studio.
2. Select **Open**.
3. Navigate to:

   `Call_Verify/android/CallVerifyReceiver`

4. Allow Gradle synchronization to finish.
5. Connect the dedicated Android receiver phone.
6. Build and install the application.
7. Configure the receiver's backend connection and device credentials.

The Android project must be configured and tested against the actual receiver device before production deployment.

---

## 9. API Integration

CallVerify is intended to be integrated by other applications through its REST API.

A typical integration will:

1. Create a verification session.
2. Display the receiver number and call instructions.
3. Allow the user to initiate the call.
4. Poll the session status.
5. Handle success, failure, expiration, and cancellation.

The API should be treated as the integration boundary. Client applications should not need direct access to the Android receiver.

The API specification and endpoint documentation should be maintained alongside the backend as the service evolves.

---

## 10. Current Development Scope

The current project is a development starter.

It includes:

- Express backend
- Verification session endpoints
- API-key authentication
- Browser verification interface
- Android receiver project
- Call-screening service reference
- Basic verification event flow

The project is not yet a complete production-grade verification platform.

---

## 11. Important Security and Verification Limitations

An incoming-call event proves that the receiving phone received a call.

The current single-session approach associates an incoming event with an active verification session. It does not, by itself, provide cryptographic proof that:

- The caller used the phone number entered into the website.
- The caller is the same person using the website.
- The phone number is permanently owned by the user.
- The verification cannot be spoofed or triggered by another caller.

CallVerify should not currently be used as strong identity verification, KYC evidence, account recovery proof, or a standalone fraud-control mechanism.

The verification logic must be strengthened before these use cases are supported.

---

## 12. Development Roadmap

The next development stages are:

### Phase 1 — Stabilize the working flow

- Preserve the working backend and Android receiver.
- Confirm successful session creation.
- Confirm real incoming-call detection.
- Confirm backend event acceptance.
- Confirm successful verification and automatic call rejection.

### Phase 2 — Improve backend reliability

- Replace in-memory sessions with PostgreSQL.
- Implement atomic session allocation.
- Add expiration and cleanup.
- Add rate limiting.
- Add structured logs and error handling.

### Phase 3 — Improve Android reliability

- Validate Android call-screening behavior.
- Handle network failures and retries.
- Secure device authentication.
- Test reboot recovery and background restrictions.
- Test dual-SIM and carrier behavior.

### Phase 4 — Build the integration API

- Publish complete API documentation.
- Add client integration examples.
- Implement production-ready session states.
- Add webhook support if required.

### Phase 5 — Production deployment

- Deploy the backend behind HTTPS.
- Configure production secrets.
- Add monitoring and alerting.
- Establish data retention and privacy controls.
- Validate telecom and regulatory requirements.

---

## 13. Contributing

CallVerify is being developed collaboratively.

Contributors should:

1. Clone the repository.
2. Create a feature branch.
3. Make focused changes.
4. Test the backend and Android receiver.
5. Submit a pull request for review.

Do not overwrite the stable verification flow without testing the complete end-to-end process.

---

## Project Goal

CallVerify aims to provide a simple, API-first alternative to SMS-based phone verification by using a real phone call and a dedicated receiving device.

The long-term goal is to make call-based verification easy to integrate into websites, mobile applications, and business systems.

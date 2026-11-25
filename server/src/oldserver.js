previous one
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3000);

// Initial session preparation window: 90 seconds.
const SESSION_TTL_SECONDS = 90;

// Actual call-detection window after the user taps Call to Verify.
const CALL_WINDOW_SECONDS = 30;

const RETENTION_SECONDS = Number(
    process.env.SESSION_RETENTION_SECONDS || 3600
);

const API_KEY = process.env.API_KEY || '';
const DEVICE_KEY = process.env.DEVICE_KEY || '';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '32kb' }));

// Development storage.
// Sessions are currently held in memory.
const sessions = new Map();

// One active pending session per normalized phone number.
const pendingByPhone = new Map();

const events = [];

function safeEqual(a = '', b = '') {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));

    return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function requireKey(expected) {
    return (req, res, next) => {
        const supplied = (req.headers.authorization || '')
            .replace(/^Bearer\s+/i, '');

        if (!expected || !safeEqual(supplied, expected)) {
            return res.status(401).json({
                error: 'unauthorized',
                message: 'Authentication failed.'
            });
        }

        next();
    };
}

const requireApiKey = requireKey(API_KEY);
const requireDeviceKey = requireKey(DEVICE_KEY);

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');

    if (digits.startsWith('234') && digits.length === 13) {
        return '+' + digits;
    }

    if (digits.startsWith('0') && digits.length === 11) {
        return '+234' + digits.slice(1);
    }

    if (digits.length === 10) {
        return '+234' + digits;
    }

    return null;
}

function maskPhone(value) {
    if (!value) return null;

    return value.slice(0, 7) + '****' + value.slice(-2);
}

function publicSession(session) {
    return {
        id: session.id,
        status: session.status,
        stage: session.callStarted ? 'call' : 'ready',
        callStarted: session.callStarted,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        callDetectedAt: session.callDetectedAt || null,
        assurance: session.status === 'verified'
            ? 'caller_id_matched'
            : 'not_verified'
    };
}

function releasePhone(session) {
    if (
        pendingByPhone.get(session.phoneNumber) === session.id
    ) {
        pendingByPhone.delete(session.phoneNumber);
    }
}

function expireSession(session) {
    if (
        session.status === 'pending' &&
        Date.now() >= session.expiresAt
    ) {
        session.status = 'expired';
        releasePhone(session);
    }
}

function cleanupSessions() {
    const now = Date.now();

    for (const session of sessions.values()) {
        expireSession(session);

        const retentionExpiry =
            session.createdAtMs + RETENTION_SECONDS * 1000;

        if (
            session.status !== 'pending' &&
            now > retentionExpiry
        ) {
            sessions.delete(session.id);
        }
    }
}

const cleanupTimer = setInterval(cleanupSessions, 15000);
cleanupTimer.unref();

function createSession(phoneInput, reference = null, metadata = {}) {
    const phoneNumber = normalizePhone(phoneInput);

    if (!phoneNumber) {
        return {
            error: 'invalid_phone_number',
            statusCode: 400,
            message: 'Enter a valid Nigerian phone number.'
        };
    }

    cleanupSessions();

    const existingId = pendingByPhone.get(phoneNumber);

    if (existingId) {
        const existing = sessions.get(existingId);

        if (existing) {
            expireSession(existing);

            if (existing.status === 'pending') {
                return {
                    error: 'verification_busy',
                    statusCode: 409,
                    message:
                        'A verification for this phone number is already active. Try again shortly.'
                };
            }
        }

        pendingByPhone.delete(phoneNumber);
    }

    const now = Date.now();

    const session = {
        id: randomUUID(),
        phoneNumber,
        reference,
        metadata,

        status: 'pending',
        callStarted: false,

        createdAt: new Date(now).toISOString(),
        createdAtMs: now,

        // Initial 90-second preparation window.
        expiresAt: now + SESSION_TTL_SECONDS * 1000,

        callDetectedAt: null
    };

    sessions.set(session.id, session);
    pendingByPhone.set(phoneNumber, session.id);

    return {
        session,
        response: {
            ...publicSession(session),
            dialNumber: process.env.PUBLIC_DIAL_NUMBER || null,
            instructions:
                'Tap Call to Verify, then call the dedicated number from the phone being verified.',
            preparationWindowSeconds: SESSION_TTL_SECONDS,
            callWindowSeconds: CALL_WINDOW_SECONDS
        }
    };
}

function getSession(sessionId) {
    const session = sessions.get(sessionId);

    if (!session) {
        return null;
    }

    expireSession(session);

    return session;
}

// Health check.
app.get('/v1/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'callverify-api',
        version: '1.3.0'
    });
});

// Create verification session for API customers.
app.post('/v1/verifications', requireApiKey, (req, res) => {
    const schema = z.object({
        phoneNumber: z.string().min(10).max(20),
        reference: z.string().max(100).optional(),
        metadata: z.record(z.any()).optional()
    });

    const parsed = schema.safeParse(req.body || {});

    if (!parsed.success) {
        return res.status(400).json({
            error: 'invalid_request',
            details: parsed.error.flatten()
        });
    }

    const result = createSession(
        parsed.data.phoneNumber,
        parsed.data.reference || null,
        parsed.data.metadata || {}
    );

    if (result.error) {
        return res.status(result.statusCode).json({
            error: result.error,
            message: result.message
        });
    }

    return res.status(201).json(result.response);
});

// Create verification session for the public website.
app.post('/web/verifications', (req, res) => {
    const schema = z.object({
        phoneNumber: z.string().min(10).max(20)
    });

    const parsed = schema.safeParse(req.body || {});

    if (!parsed.success) {
        return res.status(400).json({
            error: 'invalid_request',
            message: 'Enter a valid phone number.'
        });
    }

    const result = createSession(parsed.data.phoneNumber);

    if (result.error) {
        return res.status(result.statusCode).json({
            error: result.error,
            message: result.message
        });
    }

    return res.status(201).json(result.response);
});

// Start the short call-detection window.
// This endpoint is called when the user taps Call to Verify.
function startCallWindow(sessionId, res) {
    const session = getSession(sessionId);

    if (!session) {
        return res.status(404).json({
            error: 'not_found',
            message: 'Verification session not found.'
        });
    }

    if (session.status === 'verified') {
        return res.json({
            ...publicSession(session),
            message: 'This verification is already complete.'
        });
    }

    if (session.status === 'expired') {
        return res.status(410).json({
            error: 'session_expired',
            message: 'This verification session has expired. Start a new one.'
        });
    }

    // Make the start action idempotent.
    // Repeated clicks must not keep extending the timer.
    if (!session.callStarted) {
        session.callStarted = true;
        session.callStartedAt = Date.now();

        session.expiresAt =
            session.callStartedAt + CALL_WINDOW_SECONDS * 1000;
    }

    return res.json({
        ...publicSession(session),
        callWindowSeconds: CALL_WINDOW_SECONDS,
        message: 'Call window started.'
    });
}

// Website call-start endpoint.
app.post(
    '/web/verifications/:id/start-call',
    (req, res) => {
        return startCallWindow(req.params.id, res);
    }
);

// API customer call-start endpoint.
app.post(
    '/v1/verifications/:id/start-call',
    requireApiKey,
    (req, res) => {
        return startCallWindow(req.params.id, res);
    }
);

// Check verification status for API customers.
app.get(
    '/v1/verifications/:id',
    requireApiKey,
    (req, res) => {
        const session = getSession(req.params.id);

        if (!session) {
            return res.status(404).json({
                error: 'not_found',
                message: 'Verification session not found.'
            });
        }

        return res.json(publicSession(session));
    }
);

// Check verification status for website.
app.get('/web/verifications/:id', (req, res) => {
    const session = getSession(req.params.id);

    if (!session) {
        return res.status(404).json({
            error: 'not_found',
            message: 'Verification session not found.'
        });
    }

    return res.json(publicSession(session));
});

// Android receiver: incoming call event.
app.post(
    '/v1/device/events',
    requireDeviceKey,
    (req, res) => {
        const schema = z.object({
            type: z.enum([
                'incoming_call_ringing',
                'incoming_call_missed',
                'incoming_call_answered',
                'incoming_call_ended'
            ]),
            callerNumber: z.string().min(5).max(30),
            occurredAt: z.string().datetime().optional(),
            deviceId: z.string().max(100).optional()
        });

        const parsed = schema.safeParse(req.body || {});

        if (!parsed.success) {
            return res.status(400).json({
                error: 'invalid_event',
                details: parsed.error.flatten()
            });
        }

        const callerNumber = normalizePhone(
            parsed.data.callerNumber
        );

        if (!callerNumber) {
            return res.status(400).json({
                error: 'invalid_caller_number'
            });
        }

        const receivedAt = new Date().toISOString();

        events.push({
            type: parsed.data.type,
            callerNumber: maskPhone(callerNumber),
            deviceId: parsed.data.deviceId || null,
            receivedAt
        });

        // Match only the pending session for this caller.
        const sessionId = pendingByPhone.get(callerNumber);
        const session = sessionId
            ? sessions.get(sessionId)
            : null;

        if (session) {
            expireSession(session);
        }

        /*
         * Verification is allowed only after the user has
         * explicitly started the 30-second call window.
         */
        if (
            session &&
            session.status === 'pending' &&
            session.callStarted === true &&
            parsed.data.type === 'incoming_call_ringing'
        ) {
            session.status = 'verified';
            session.callDetectedAt = receivedAt;

            releasePhone(session);

            return res.status(202).json({
                accepted: true,
                matched: true,
                status: 'verified',
                message: 'Caller number matched.'
            });
        }

        return res.status(202).json({
            accepted: true,
            matched: false,
            status: session?.status || 'no_matching_session'
        });
    }
);

// Admin: recent receiver events.
app.get(
    '/v1/admin/events',
    requireDeviceKey,
    (_req, res) => {
        res.json({
            events: events.slice(-100)
        });
    }
);

// Serve the CallVerify website.
app.use(express.static(PUBLIC_DIR));

app.use((err, _req, res, _next) => {
    console.error(err);

    res.status(500).json({
        error: 'internal_error'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`CallVerify API listening on :${PORT}`);
    console.log(`Website folder: ${PUBLIC_DIR}`);
    console.log(`Preparation window: ${SESSION_TTL_SECONDS}s`);
    console.log(`Call window: ${CALL_WINDOW_SECONDS}s`);
});

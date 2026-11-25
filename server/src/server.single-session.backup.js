
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.static(PUBLIC_DIR));

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
const DEVICE_KEY = process.env.DEVICE_KEY || '';
const TTL = Number(process.env.SESSION_TTL_SECONDS || 180);

const sessions = new Map();
let activeSessionId = null;
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
            return res.status(401).json({ error: 'unauthorized' });
        }

        next();
    };
}

const requireApiKey = requireKey(API_KEY);
const requireDeviceKey = requireKey(DEVICE_KEY);

// Normalize Nigerian phone numbers to +234XXXXXXXXXX
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

function publicSession(s) {
    return {
        id: s.id,
        status: s.status,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        callDetectedAt: s.callDetectedAt || null,
        assurance: s.status === 'verified'
            ? 'caller_id_matched'
            : 'not_verified'
    };
}

function expireSession(s) {
    if (s.status === 'pending' && Date.now() > s.expiresAt) {
        s.status = 'expired';

        if (activeSessionId === s.id) {
            activeSessionId = null;
        }
    }
}

app.get('/v1/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'callverify-api',
        version: '1.1.0'
    });
});

// CREATE VERIFICATION SESSION
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

    const phoneNumber = normalizePhone(parsed.data.phoneNumber);

    if (!phoneNumber) {
        return res.status(400).json({
            error: 'invalid_phone_number',
            message: 'Enter a valid Nigerian phone number.'
        });
    }

    const now = Date.now();

    if (activeSessionId) {
        const active = sessions.get(activeSessionId);

        if (active) expireSession(active);

        if (active && active.status === 'pending') {
            return res.status(409).json({
                error: 'verification_busy',
                message: 'Another verification is active. Try again shortly.'
            });
        }
    }

    const session = {
        id: randomUUID(),
        phoneNumber,
        reference: parsed.data.reference || null,
        metadata: parsed.data.metadata || {},
        status: 'pending',
        createdAt: new Date(now).toISOString(),
        expiresAt: now + TTL * 1000
    };

    sessions.set(session.id, session);
    activeSessionId = session.id;

    res.status(201).json({
        ...publicSession(session),
        dialNumber: process.env.PUBLIC_DIAL_NUMBER || null,
        instructions: 'Call the dedicated number from the phone being verified.'
    });
});

// CHECK VERIFICATION STATUS
app.get('/v1/verifications/:id', requireApiKey, (req, res) => {

    const session = sessions.get(req.params.id);

    if (!session) {
        return res.status(404).json({ error: 'not_found' });
    }

    expireSession(session);

    res.json(publicSession(session));
});

// RECEIVE AND MATCH INCOMING CALL
app.post('/v1/device/events', requireDeviceKey, (req, res) => {

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

    const callerNumber = normalizePhone(parsed.data.callerNumber);

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

    const now = Date.now();
    const session = activeSessionId
        ? sessions.get(activeSessionId)
        : null;

    if (session) expireSession(session);

    if (
        session &&
        session.status === 'pending' &&
        session.expiresAt >= now &&
        parsed.data.type === 'incoming_call_ringing'
    ) {

        if (session.phoneNumber === callerNumber) {

            session.status = 'verified';
            session.callDetectedAt = receivedAt;
            session.callerNumber = callerNumber;

            activeSessionId = null;

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
            status: 'pending',
            message: 'Incoming caller does not match the submitted number.'
        });
    }

    res.status(202).json({
        accepted: true,
        matched: false,
        status: session?.status || 'no_active_session'
    });
});


/* WEBSITE: CREATE VERIFICATION SESSION */
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

    const phoneNumber = normalizePhone(parsed.data.phoneNumber);

    if (!phoneNumber) {
        return res.status(400).json({
            error: 'invalid_phone_number',
            message: 'Enter a valid Nigerian phone number.'
        });
    }

    if (!process.env.PUBLIC_DIAL_NUMBER) {
        return res.status(503).json({
            error: 'service_unavailable',
            message: 'The verification line is not configured.'
        });
    }

    const now = Date.now();

    if (activeSessionId) {
        const active = sessions.get(activeSessionId);

        if (active) expireSession(active);

        if (active && active.status === 'pending') {
            return res.status(409).json({
                error: 'verification_busy',
                message: 'Another verification is active. Try again shortly.'
            });
        }
    }

    const session = {
        id: randomUUID(),
        phoneNumber,
        reference: 'website',
        metadata: {},
        status: 'pending',
        createdAt: new Date(now).toISOString(),
        expiresAt: now + TTL * 1000
    };

    sessions.set(session.id, session);
    activeSessionId = session.id;

    return res.status(201).json({
        id: session.id,
        status: session.status,
        dialNumber: process.env.PUBLIC_DIAL_NUMBER,
        expiresAt: session.expiresAt,
        instructions: 'Call the dedicated number from the phone being verified.'
    });
});

/* WEBSITE: CHECK VERIFICATION STATUS */
app.get('/web/verifications/:id', (req, res) => {
    const session = sessions.get(req.params.id);

    if (!session) {
        return res.status(404).json({
            error: 'not_found',
            message: 'Verification session not found.'
        });
    }

    expireSession(session);

    return res.json({
        id: session.id,
        status: session.status,
        callDetectedAt: session.callDetectedAt || null
    });
});

// ADMIN EVENT HISTORY
app.get('/v1/admin/events', requireDeviceKey, (_req, res) => {
    res.json({
        events: events.slice(-100)
    });
});

app.use((err, _req, res, _next) => {

/* WEBSITE VERIFICATION ROUTES */

// Create a verification session from the website.
// The API key stays on the server.
app.post('/web/verifications', async (req, res) => {
    try {
        const response = await fetch(
            `http://127.0.0.1:${PORT}/v1/verifications`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${API_KEY}`
                },
                body: JSON.stringify(req.body)
            }
        );

        const data = await response.json();

        res.status(response.status).json(data);

    } catch (error) {
        console.error('Website create-session error:', error);

        res.status(502).json({
            error: 'verification_service_unavailable',
            message: 'Unable to start verification. Please try again.'
        });
    }
});

// Check verification status from the website.
app.get('/web/verifications/:id', async (req, res) => {
    try {
        const response = await fetch(
            `http://127.0.0.1:${PORT}/v1/verifications/${encodeURIComponent(req.params.id)}`,
            {
                headers: {
                    Authorization: `Bearer ${API_KEY}`
                }
            }
        );

        const data = await response.json();

        res.status(response.status).json(data);

    } catch (error) {
        console.error('Website status-check error:', error);

        res.status(502).json({
            error: 'verification_service_unavailable',
            message: 'Unable to check verification status.'
        });
    }
});

// Serve the website files from the public folder.
app.use(express.static('public'));

    console.error(err);
    res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`CallVerify API listening on :${PORT}`);
});

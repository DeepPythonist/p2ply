const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = parseInt(process.env.PORT) || 0;
const MAX_CONNS_PER_IP = 10;
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX_REQS = 100;

const ipRequestCounts = new Map();
const activePairingCodes = new Map();

function rateLimiter(req, res, next) {
    const ip = req.ip;
    const now = Date.now();

    if (!ipRequestCounts.has(ip)) {
        ipRequestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    } else {
        const data = ipRequestCounts.get(ip);
        if (now > data.resetTime) {
            data.count = 1;
            data.resetTime = now + RATE_LIMIT_WINDOW;
        } else {
            data.count++;
            if (data.count > RATE_LIMIT_MAX_REQS) {
                return res.status(429).send('Too Many Requests');
            }
        }
    }
    next();
}

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' *;");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

app.use(rateLimiter);
app.use(express.json()); // Enable JSON body parsing
app.use(express.static('public'));

let remoteUrl = null;

app.post('/set-remote-url', (req, res) => {
    if (req.body.url) {
        remoteUrl = req.body.url;
        console.log(`[Config] Remote URL updated: ${remoteUrl}`);
    }
    res.sendStatus(200);
});

io.on('connection', (socket) => {
    const ip = socket.handshake.address;

    socket.on('create-pair', () => {
        let code;
        do {
            code = Math.floor(100000 + Math.random() * 900000).toString();
        } while (activePairingCodes.has(code));

        activePairingCodes.set(code, {
            host: socket.id,
            created: Date.now()
        });

        // Send both code and remoteUrl
        socket.emit('pair-code', { code, remoteUrl });

        setTimeout(() => {
            if (activePairingCodes.has(code)) {
                activePairingCodes.delete(code);
            }
        }, 60000);
    });

    socket.on('join-pair', (code) => {
        const session = activePairingCodes.get(code);
        if (session && session.host) {
            if (session.host === socket.id) {
                socket.emit('error', 'You cannot pair with yourself!');
                return;
            }
            io.to(session.host).emit('peer-joined', socket.id);
            socket.emit('peer-found', session.host);
            activePairingCodes.delete(code);
        } else {
            socket.emit('error', 'Invalid or expired code');
        }
    });

    socket.on('signal', (data) => {
        if (data.target) {
            io.to(data.target).emit('signal', {
                sender: socket.id,
                payload: data.payload,
                type: data.type
            });
        }
    });

    socket.on('end-session', (data) => {
        if (data && data.target) {
            io.to(data.target).emit('session-ended');
        }
    });


});

const listener = server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${listener.address().port}`);
});

process.on('SIGTERM', () => {
    server.close(() => {
        process.exit(0);
    });
});

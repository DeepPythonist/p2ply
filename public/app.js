const socket = io();
let localKey = null;
let sharedSecret = null;
let peerConnection = null;
let dataChannel = null;
let remotePubKey = null;
let candidateQueue = [];
let peerSocketId = null;
let peerFingerprintFull = null;

const PADDING_SIZE = 1024;

const config = {
    iceServers: []
};

const dom = {
    status: document.getElementById('connection-status'),
    myFingerprint: document.getElementById('my-fingerprint'),
    setupPanel: document.getElementById('setup-panel'),
    btnCreate: document.getElementById('btn-create'),
    codeDisplay: document.getElementById('code-display'),
    pairingCode: document.getElementById('pairing-code'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    inputCode: document.getElementById('input-code'),
    btnJoin: document.getElementById('btn-join'),
    chatPanel: document.getElementById('chat-panel'),
    verifyModal: document.getElementById('verify-modal'),
    modalMyFingerprint: document.getElementById('modal-my-fingerprint'),
    peerFingerprintDisplay: document.getElementById('peer-fingerprint-display'),
    btnVerifyConfirm: document.getElementById('btn-verify-confirm'),
    btnVerifyReject: document.getElementById('btn-verify-reject'),
    secureChatView: document.getElementById('secure-chat-view'),
    messages: document.getElementById('messages'),
    msgInput: document.getElementById('msg-input'),
    btnSend: document.getElementById('btn-send'),
    btnKill: document.getElementById('btn-kill')
};

function log(msg) {
    console.log(`[Log] ${msg}`);
}

function updateStatus(msg, type = 'normal') {
    dom.status.textContent = msg;
    dom.status.className = 'status ' + (type === 'error' ? 'error' : (type === 'success' ? 'connected' : 'disconnected'));
}

function sendSecureSignal(type, payload) {
    const msg = { type, payload };

    if (dataChannel && dataChannel.readyState === 'open') {
        try {
            dataChannel.send(JSON.stringify(msg));
            return 'P2P';
        } catch (e) {
            log('P2P Send Error: ' + e);
        }
    }

    if (peerSocketId) {
        socket.emit('signal', {
            target: peerSocketId,
            type: 'relay-packet',
            payload: msg
        });
        return 'Relay';
    }

    throw new Error("No connection available");
}

function padMessage(text) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    if (encoded.length >= PADDING_SIZE) return text;
    const paddingLength = PADDING_SIZE - encoded.length;
    const padding = ' '.repeat(paddingLength);
    return text + '||PAD||' + padding;
}

function unpadMessage(text) {
    if (text.includes('||PAD||')) return text.split('||PAD||')[0];
    return text;
}

function tabCloak() {
    document.title = document.hidden ? "New Tab" : "P2Ply Secure";
}
document.addEventListener("visibilitychange", tabCloak);

function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('code');
    if (joinCode) {
        dom.inputCode.value = joinCode;
        const checkReady = setInterval(() => {
            if (!dom.btnJoin.disabled) {
                clearInterval(checkReady);
                updateStatus('Auto-Joining...', 'normal');
                dom.btnJoin.click();
            }
        }, 500);
    }
}

async function initCrypto() {
    updateStatus('Generating Identity...', 'normal');
    log('Generating Keys...');
    try {
        localKey = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey"]
        );
        const exported = await window.crypto.subtle.exportKey("spki", localKey.publicKey);
        const hash = await window.crypto.subtle.digest("SHA-256", exported);
        dom.myFingerprint.textContent = bufferToHex(hash).substring(0, 16);
        updateStatus('Ready', 'normal');
        log('Identity Ready.');
        dom.btnCreate.disabled = false;
        dom.btnJoin.disabled = false;
        checkUrlParams();
    } catch (e) {
        updateStatus('Crypto Error', 'error');
        log('Init Error: ' + e);
    }
}

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveSecret(remoteKeyJson) {
    updateStatus('Verifying...', 'normal');
    log('Deriving Secret...');
    try {
        const remoteKey = await window.crypto.subtle.importKey(
            "jwk",
            remoteKeyJson,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );
        remotePubKey = remoteKey;
        sharedSecret = await window.crypto.subtle.deriveKey(
            { name: "ECDH", public: remoteKey },
            localKey.privateKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
        const exported = await window.crypto.subtle.exportKey("spki", remoteKey);
        const hash = await window.crypto.subtle.digest("SHA-256", exported);
        peerFingerprintFull = bufferToHex(hash).substring(0, 16);

        dom.peerFingerprintDisplay.textContent = peerFingerprintFull;
        dom.modalMyFingerprint.textContent = dom.myFingerprint.textContent;

        updateStatus('CONFIRM IDENTITY', 'normal');
        log('Waiting for Visual Confirmation.');

        dom.setupPanel.classList.add('hidden');
        dom.chatPanel.classList.remove('hidden');
        dom.verifyModal.classList.remove('hidden');
        dom.secureChatView.classList.add('hidden');
    } catch (e) {
        log('Derive Error: ' + e);
    }
}

dom.btnVerifyConfirm.onclick = () => {
    dom.verifyModal.classList.add('hidden');
    dom.secureChatView.classList.remove('hidden');
    updateStatus('SECURE CONNECTED', 'success');
    log('Visual Auth Confirmed.');
    window.history.replaceState({}, document.title, window.location.pathname);
};

dom.btnVerifyReject.onclick = () => {
    alert("Connection Rejected.");
    reset();
};

async function encrypt(text) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const padded = padMessage(text);
    const encoded = new TextEncoder().encode(padded);
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        sharedSecret,
        encoded
    );
    return {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encrypted))
    };
}

async function decrypt(payload) {
    if (!sharedSecret) return "[NO KEYS]";
    const iv = new Uint8Array(payload.iv);
    const data = new Uint8Array(payload.data);
    try {
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            sharedSecret,
            data
        );
        const text = new TextDecoder().decode(decrypted);
        return unpadMessage(text);
    } catch (e) {
        log('Decryption Failed: ' + e);
        return "[DECRYPTION FAILED]";
    }
}

function createPeerConnection(targetId, initiator) {
    peerSocketId = targetId;
    updateStatus('Initializing P2P...', 'normal');
    log(`Init P2P (Init: ${initiator})`);
    peerConnection = new RTCPeerConnection(config);
    candidateQueue = [];

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', {
                target: targetId,
                type: 'candidate',
                payload: event.candidate
            });
        }
    };

    peerConnection.onconnectionstatechange = () => {
        log(`P2P State: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === 'connected') {
            updateStatus('SECURE P2P ACTIVE', 'success');
        } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            updateStatus('Switched to Relay', 'success');
        }
    };

    if (initiator) {
        dataChannel = peerConnection.createDataChannel("chat");
        setupDataChannel();
        createOffer(targetId);
    } else {
        peerConnection.ondatachannel = (event) => {
            log('DataChannel Received');
            dataChannel = event.channel;
            setupDataChannel();
        };
    }
}

async function handleSecurePacket(msg) {
    try {
        if (msg.type === 'handshake') {
            log('RX Handshake');
            await deriveSecret(msg.key);
        } else if (msg.type === 'chat') {
            log('RX Chat');
            const text = await decrypt(msg.payload);
            addMessage(text, 'received');
        }
    } catch (e) {
        log('Packet Error: ' + e);
    }
}

function setupDataChannel() {
    if (dataChannel.readyState === 'open') {
        sendHandshake();
    } else {
        dataChannel.onopen = sendHandshake;
    }

    dataChannel.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        handleSecurePacket(msg);
    };
}

async function sendHandshake() {
    log('Sending Handshake');
    const pubKey = await window.crypto.subtle.exportKey("jwk", localKey.publicKey);
    sendSecureSignal('handshake', { key: pubKey });
}

async function createOffer(targetId) {
    updateStatus('Creating Offer...', 'normal');
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    log('Sending Offer');
    const pubKey = await window.crypto.subtle.exportKey("jwk", localKey.publicKey);
    socket.emit('signal', {
        target: targetId,
        type: 'offer_with_key',
        payload: {
            sdp: offer,
            key: pubKey
        }
    });
}

function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    div.textContent = text;
    appendTimestamp(div);
    dom.messages.appendChild(div);
    dom.messages.scrollTop = dom.messages.scrollHeight;
}

function appendTimestamp(container) {
    const time = document.createElement('span');
    time.className = 'timestamp';
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    container.appendChild(time);
}

function reset() {
    if (peerConnection) peerConnection.close();
    if (dataChannel) dataChannel.close();
    dom.setupPanel.classList.remove('hidden');
    dom.chatPanel.classList.add('hidden');
    dom.verifyModal.classList.add('hidden');
    dom.secureChatView.classList.add('hidden');
    updateStatus('Disconnected', 'normal');
    dom.messages.innerHTML = '';
}

let currentRemoteUrl = null;

dom.msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') dom.btnSend.click();
});

dom.btnCreate.onclick = () => {
    updateStatus('Creating...', 'normal');
    socket.emit('create-pair');
};

dom.btnCopyLink.onclick = () => {
    const code = dom.pairingCode.textContent;
    let baseUrl = window.location.origin;
    if (currentRemoteUrl && baseUrl.includes('localhost')) baseUrl = currentRemoteUrl;
    if (baseUrl.includes('localhost.run') || baseUrl.includes('lhr.life')) baseUrl = baseUrl.replace('http://', 'https://');
    const url = `${baseUrl}${window.location.pathname}?code=${code}`;
    navigator.clipboard.writeText(url).then(() => {
        const t = dom.btnCopyLink.textContent;
        dom.btnCopyLink.textContent = "Copied!";
        setTimeout(() => dom.btnCopyLink.textContent = t, 2000);
    });
};

dom.btnJoin.onclick = () => {
    const code = dom.inputCode.value;
    if (code) {
        updateStatus('Joining...', 'normal');
        socket.emit('join-pair', code);
    }
};

dom.btnSend.onclick = async () => {
    const text = dom.msgInput.value;
    if (!text) return;

    const encrypted = await encrypt(text);

    try {
        const method = sendSecureSignal('chat', encrypted);
        addMessage(text, 'sent');
        log(`Sent via ${method}`);
    } catch (e) {
        log('Send Failed: ' + e);
    }

    dom.msgInput.value = '';
};

dom.btnKill.onclick = () => {
    if (peerSocketId) socket.emit('end-session', { target: peerSocketId });
    reset();
    location.reload();
};

socket.on('pair-code', (data) => {
    dom.codeDisplay.classList.remove('hidden');
    if (typeof data === 'object') {
        dom.pairingCode.textContent = data.code;
        currentRemoteUrl = data.remoteUrl;
    } else {
        dom.pairingCode.textContent = data;
    }
    updateStatus('Waiting for Peer...', 'normal');
});

socket.on('peer-found', (id) => createPeerConnection(id, true));
socket.on('peer-joined', (id) => createPeerConnection(id, false));
socket.on('error', (err) => { updateStatus(err, 'error'); log('Socket Error: ' + err); });
socket.on('session-ended', () => { alert('Peer ended session.'); reset(); location.reload(); });

socket.on('signal', async (data) => {
    if (!peerSocketId) peerSocketId = data.sender;

    if (data.type === 'offer_with_key') {
        log('RX Offer');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.payload.sdp));
        if (data.payload.key) {
            await deriveSecret(data.payload.key);
            const pubKey = await window.crypto.subtle.exportKey("jwk", localKey.publicKey);
            socket.emit('signal', { target: data.sender, type: 'key-handshake', payload: pubKey });
        }
        while (candidateQueue.length > 0) await peerConnection.addIceCandidate(candidateQueue.shift());
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', { target: data.sender, type: 'answer', payload: answer });
    } else if (data.type === 'answer') {
        log('RX Answer');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.payload));
        while (candidateQueue.length > 0) await peerConnection.addIceCandidate(candidateQueue.shift());
    } else if (data.type === 'candidate') {
        if (peerConnection.remoteDescription) await peerConnection.addIceCandidate(new RTCIceCandidate(data.payload));
        else candidateQueue.push(new RTCIceCandidate(data.payload));
    } else if (data.type === 'key-handshake') {
        log('RX Key Handshake');
        await deriveSecret(data.payload);

    } else if (data.type === 'chat-relay') {
        log('RX Legacy Relay');
        const text = await decrypt(data.payload);
        addMessage(text, 'received');

    } else if (data.type === 'relay-packet') {
        handleSecurePacket(data.payload);
    }
});

initCrypto();

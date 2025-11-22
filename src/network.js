import { getPlayer, setDbChannel, getAllPlayers } from './db.js';
import { appendHostLog } from './network-common.js';
import { setupHostListeners, setupPresenceWatcher, startTaskCompletionLoop } from './network-host.js';
import { handleTwitchChat } from './host-chat.js';

// Simulation of a JWT Secret (In a real app, this is server-side only)
const SECRET_KEY = "mock_secret_key_" + Math.random();

export class NetworkManager {
    constructor(room, isHost, user) {
        this.room = room;
        this.isHost = isHost;
        this.user = user;
        this.tmiClient = null;
        this.pendingLinks = {}; // code -> { websimClientId, createdAt }
        this.taskCompletionInterval = null; // interval handle for completing tasks

        this.onEnergyUpdate = null;
        this.onTaskUpdate = null;
        this.onLinkSuccess = null;
        this.onLinkCode = null;
        this.onStateUpdate = null;
        this.onPresenceUpdate = null;
        this.onPlayerListUpdate = null;
        this.onTokenInvalid = null; // fired when host rejects/expired token

        this.initialize();
    }

    async initialize() {
        if (this.isHost) {
            // Restore channel context if available
            const savedChannel = localStorage.getItem('sq_host_channel');
            if (savedChannel) {
                setDbChannel(savedChannel);
                appendHostLog(`DB context set for channel "${savedChannel}"`);
            }

            console.log("Initializing Host Logic...");
            setupHostListeners(this);
            setupPresenceWatcher(this);
            // Initial load of Twitch users for current DB context
            this.refreshPlayerList();

            // Start background loop to complete finished tasks
            startTaskCompletionLoop(this);
        } else {
            console.log("Initializing Client Logic...");
            this.setupClientListeners();
        }
    }

    // --- HOST LOGIC ---

    connectTwitch(channelName) {
        if (!this.isHost) return;

        // Update DB Context
        setDbChannel(channelName);
        localStorage.setItem('sq_host_channel', channelName);
        appendHostLog(`Connecting to Twitch channel "${channelName}"...`);

        if (this.tmiClient) this.tmiClient.disconnect();

        // tmi is global from the script tag fallback if import fails, or import map
        const tmi = window.tmi; 

        this.tmiClient = new tmi.Client({
            channels: [channelName]
        });

        this.tmiClient.connect().then(() => {
            appendHostLog(`Connected to Twitch channel "${channelName}".`);
        }).catch(err => {
            console.error(err);
            appendHostLog(`Error connecting to Twitch: ${err?.message || err}`);
        });

        this.tmiClient.on('message', (channel, tags, message, self) => {
            if (self) return;
            // Log every message to host console
            const uname = tags['display-name'] || tags['username'] || 'unknown';
            appendHostLog(`[CHAT] ${uname}: ${message}`);
            this.handleTwitchMessage(tags, message);
        }); 

        // Reload Twitch users for this channel's DB
        this.refreshPlayerList();

        return true;
    }

    cleanupExpiredCodes() {
        const now = Date.now();
        const ttl = 5 * 60 * 1000; // 5 minutes
        for (const [code, entry] of Object.entries(this.pendingLinks)) {
            if (!entry || now - entry.createdAt > ttl) {
                appendHostLog(`Link code "${code}" expired and was removed.`);
                delete this.pendingLinks[code];
            }
        }
    }

    async handleTwitchMessage(tags, message) {
        return handleTwitchChat(this, tags, message);
    }

    async exportChannelData() {
        if (!this.isHost) return [];
        const players = await getAllPlayers();
        appendHostLog(`Exported ${players.length} players for current channel.`);
        return players;
    }

    async importChannelData(playersArray, replaceAllPlayersFn) {
        if (!this.isHost) return;
        if (typeof replaceAllPlayersFn !== 'function') return;

        await replaceAllPlayersFn(playersArray || []);
        appendHostLog(`Imported ${playersArray?.length || 0} players for current channel (overwrote existing data).`);
        await this.refreshPlayerList();
    }

    async refreshPlayerList() {
        if (!this.isHost || !this.onPlayerListUpdate) return;
        const players = await getAllPlayers();
        const peers = this.room.peers || {};
        this.onPlayerListUpdate(players, peers);
    }

    async validateToken(token) {
        try {
            const decoded = JSON.parse(atob(token));
            if (decoded.exp < Date.now()) return null;
            return await getPlayer(decoded.twitchId);
        } catch (e) {
            return null;
        }
    }

    // --- CLIENT LOGIC ---

    setupClientListeners() {
        this.room.onmessage = (event) => {
            const data = event.data;

            // Filter messages meant for me
            if (data.targetId && data.targetId !== this.room.clientId) return;

            switch (data.type) {
                case 'link_code_generated':
                    if (this.onLinkCode) this.onLinkCode(data.code);
                    break;
                case 'link_success':
                    localStorage.setItem('sq_token', data.token);
                    if (this.onLinkSuccess) this.onLinkSuccess(data.playerData);
                    break;
                case 'sync_data':
                case 'state_update':
                case 'energy_update':
                    if (data.energy) {
                        // partial update handling if needed
                    }
                    if (data.playerData && this.onStateUpdate) {
                        this.onStateUpdate(data.playerData);
                    }
                    break;
                case 'token_invalid':
                    // Host rejected token (likely expired) – clear it and notify UI
                    localStorage.removeItem('sq_token');
                    if (this.onTokenInvalid) this.onTokenInvalid();
                    break;
            }
        };
    }

    requestLinkCode() {
        this.room.send({ type: 'request_link_code' });
    }

    syncWithToken(token) {
        this.room.send({ type: 'sync_request', token });
    }

    startTask(taskId, duration) {
        const token = localStorage.getItem('sq_token'); 
        this.room.send({ 
            type: 'start_task', 
            taskId, 
            duration,
            token: token 
        });
    }

    stopTask() {
        this.room.send({ 
            type: 'stop_task', 
            token: localStorage.getItem('sq_token') 
        });
    }

    // New: request a de-link so host can clear the Twitch <-> WebSim association
    requestDelink() {
        const token = localStorage.getItem('sq_token');
        if (!token) return;
        this.room.send({
            type: 'client_delink',
            token
        });
    }
}
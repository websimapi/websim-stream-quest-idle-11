import { savePlayer, getPlayer, createNewPlayer, setDbChannel, getAllPlayers } from './db.js';
import { SKILLS } from './skills.js';
import { appendHostLog, ONE_HOUR_MS, getAvailableEnergyCount, normalizeActiveEnergy } from './network-common.js';
import { setupHostListeners, setupPresenceWatcher, startTaskCompletionLoop } from './network-host.js';

// Simulation of a JWT Secret (In a real app, this is server-side only)
const SECRET_KEY = "mock_secret_key_" + Math.random();

// XP scaling parameters for skills (mirrors host-messages.js and ui-skills.js)
const XP_BASE = 50;
const XP_ALPHA = 1.75;
const XP_BETA = 0.02;

// XP needed for a single level (not cumulative)
function xpForLevel(level) {
    if (level <= 0) return 0;
    return XP_BASE * Math.pow(level, XP_ALPHA) * (1 + level * XP_BETA);
}

// Given total accumulated XP, compute level (host-side)
function getLevelInfo(totalXp) {
    let level = 1;
    let xpRemaining = totalXp || 0;

    while (true) {
        const req = xpForLevel(level);
        if (xpRemaining >= req) {
            xpRemaining -= req;
            level++;
        } else {
            break;
        }
    }

    const nextReq = xpForLevel(level) || 1;
    const progress = Math.max(0, Math.min(1, xpRemaining / nextReq));

    return {
        level,
        progress,
        currentXpInLevel: xpRemaining,
        xpForNextLevel: nextReq
    };
}

// Sum total XP for a given skill from completion records
function computeSkillXp(playerData, skillId) {
    if (!playerData || !playerData.skills || !playerData.skills[skillId]) return 0;
    const skillData = playerData.skills[skillId];
    const tasks = skillData.tasks || {};
    let total = 0;

    Object.values(tasks).forEach(records => {
        if (!Array.isArray(records)) return;
        records.forEach(rec => {
            if (rec && typeof rec.xp === 'number') {
                total += rec.xp;
            }
        });
    });

    return total;
}

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

    generateLinkCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
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
        const twitchId = tags['user-id'];
        const username = tags['username'];
        const now = Date.now();

        // 1. Energy / player normalization
        let player = await getPlayer(twitchId);
        if (!player) {
            player = createNewPlayer(username, twitchId);
            appendHostLog(`New Twitch user detected: ${username} (${twitchId}).`);
        }

        // Ensure energy/skills structures exist on older records
        if (!Array.isArray(player.energy)) player.energy = [];
        if (!player.skills) player.skills = {};
        if (player.activeEnergy && !player.activeEnergy.startTime && typeof player.activeEnergy.consumedMs !== 'number') {
            player.activeEnergy = null;
        }

        // Clear expired active energy (if any)
        await normalizeActiveEnergy(player);

        // Grant stored energy based on chat activity (5 minute cooldown)
        if (now - player.lastChatTime > 300000) { 
            const totalAvailable = getAvailableEnergyCount(player);
            if (totalAvailable < 12) {
                player.energy.push(now); // Add stored energy cell
                appendHostLog(`Stored energy +1 for ${username} (now ${getAvailableEnergyCount(player)}/12).`);
                // Notify if they are online via WebSim
                if (player.linkedWebsimId) {
                    this.room.send({
                        type: 'energy_update',
                        targetId: player.linkedWebsimId,
                        energy: player.energy,
                        activeEnergy: player.activeEnergy
                    });
                }
            }
            player.lastChatTime = now;
            await savePlayer(twitchId, player);
        }

        // 2. Command Logic
        const rawMsg = message.trim();
        const lowerMsg = rawMsg.toLowerCase();

        if (lowerMsg.startsWith('!link ')) {
            const code = rawMsg.split(' ')[1];
            appendHostLog(`!link attempt by ${username} with code "${code}".`);
            this.cleanupExpiredCodes();
            const entry = this.pendingLinks[code];
            if (entry) {
                const websimClientId = entry.websimClientId;

                // Link them
                player.linkedWebsimId = websimClientId;
                await savePlayer(twitchId, player);

                // Generate "Token"
                const token = btoa(JSON.stringify({ twitchId, exp: now + (7 * 24 * 60 * 60 * 1000) }));

                // Inform Client
                this.room.send({
                    type: 'link_success',
                    targetId: websimClientId,
                    token: token,
                    playerData: player
                });

                delete this.pendingLinks[code];
                appendHostLog(`Link success: ${username} ↔ WebSim client ${websimClientId}.`);
                console.log(`Linked ${username} to websim client ${websimClientId}`);
            } else {
                appendHostLog(`Link failed for ${username}: code "${code}" not found or expired.`);
            }
        } else if (lowerMsg.startsWith('!chop')) {
            // Woodcutting commands:
            // !chop            → highest tree available by level
            // !chop oak        → force Oak
            // !chop willow     → force Willow
            // !chop maple      → force Maple
            const parts = lowerMsg.split(/\s+/);
            const arg = (parts[1] || '').trim();

            if (player.activeTask) {
                appendHostLog(`!chop from ${username} ignored: task already in progress (${player.activeTask.taskId}).`);
            } else {
                const woodSkill = SKILLS.woodcutting;
                const totalXp = computeSkillXp(player, woodSkill.id);
                const levelInfo = getLevelInfo(totalXp);
                const playerLevel = levelInfo.level;

                let targetTask = null;

                if (!arg) {
                    // Highest task they meet the level requirement for
                    const candidates = woodSkill.tasks
                        .filter(t => playerLevel >= (t.level || 1))
                        .sort((a, b) => (b.level || 1) - (a.level || 1));
                    targetTask = candidates[0] || null;
                } else if (arg === 'oak') {
                    targetTask = woodSkill.tasks.find(t => t.id === 'wc_oak') || null;
                } else if (arg === 'willow') {
                    targetTask = woodSkill.tasks.find(t => t.id === 'wc_willow') || null;
                } else if (arg === 'maple') {
                    targetTask = woodSkill.tasks.find(t => t.id === 'wc_maple') || null;
                } else {
                    appendHostLog(`!chop from ${username} ignored: unknown tree "${arg}".`);
                }

                if (!targetTask) {
                    appendHostLog(`!chop from ${username} failed: no eligible woodcutting task for level ${playerLevel}.`);
                } else if (playerLevel < (targetTask.level || 1)) {
                    appendHostLog(
                        `!chop from ${username} denied: level ${playerLevel} < required ${targetTask.level} for "${targetTask.name}".`
                    );
                } else {
                    const totalAvailable = getAvailableEnergyCount(player);
                    if (totalAvailable <= 0) {
                        appendHostLog(`!chop from ${username} denied: no energy (pool empty and no active cell).`);
                    } else {
                        // Ensure an active energy cell
                        const hasActiveEnergy =
                            player.activeEnergy &&
                            (typeof player.activeEnergy.consumedMs === 'number'
                                ? player.activeEnergy.consumedMs < ONE_HOUR_MS
                                : true);

                        if (!hasActiveEnergy) {
                            if (player.energy.length > 0) {
                                player.energy.shift(); // consume stored energy
                                player.activeEnergy = { consumedMs: 0 };
                                appendHostLog(`Energy cell activated for ${username} (1h of active time).`);
                            } else {
                                appendHostLog(
                                    `!chop from ${username} denied: race condition left no stored energy.`
                                );
                                await savePlayer(twitchId, player);
                                this.refreshPlayerList();
                                return;
                            }
                        }

                        // Start the task
                        player.activeTask = {
                            taskId: targetTask.id,
                            startTime: now,
                            duration: targetTask.duration
                        };
                        // Clear paused/manual stop state
                        player.pausedTask = null;
                        player.manualStop = false;

                        await savePlayer(twitchId, player);
                        appendHostLog(
                            `!chop from ${username}: started "${targetTask.name}" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );

                        if (player.linkedWebsimId) {
                            this.room.send({
                                type: 'state_update',
                                targetId: player.linkedWebsimId,
                                playerData: player
                            });
                        }
                    }
                }
            }
        } else if (lowerMsg === '!sift') {
            // Scavenging: Sift Trash
            const scavSkill = SKILLS.scavenging;
            const task = scavSkill.tasks.find(t => t.id === 'sc_trash');

            if (player.activeTask) {
                appendHostLog(`!sift from ${username} ignored: task already in progress (${player.activeTask.taskId}).`);
            } else if (!task) {
                appendHostLog(`!sift from ${username} failed: task definition missing (sc_trash).`);
            } else {
                const totalXp = computeSkillXp(player, scavSkill.id);
                const levelInfo = getLevelInfo(totalXp);
                const playerLevel = levelInfo.level;

                if (playerLevel < (task.level || 1)) {
                    appendHostLog(
                        `!sift from ${username} denied: level ${playerLevel} < required ${task.level} for "${task.name}".`
                    );
                } else {
                    const totalAvailable = getAvailableEnergyCount(player);
                    if (totalAvailable <= 0) {
                        appendHostLog(`!sift from ${username} denied: no energy (pool empty and no active cell).`);
                    } else {
                        const hasActiveEnergy =
                            player.activeEnergy &&
                            (typeof player.activeEnergy.consumedMs === 'number'
                                ? player.activeEnergy.consumedMs < ONE_HOUR_MS
                                : true);

                        if (!hasActiveEnergy) {
                            if (player.energy.length > 0) {
                                player.energy.shift();
                                player.activeEnergy = { consumedMs: 0 };
                                appendHostLog(`Energy cell activated for ${username} (1h of active time).`);
                            } else {
                                appendHostLog(
                                    `!sift from ${username} denied: race condition left no stored energy.`
                                );
                                await savePlayer(twitchId, player);
                                this.refreshPlayerList();
                                return;
                            }
                        }

                        player.activeTask = {
                            taskId: task.id,
                            startTime: now,
                            duration: task.duration
                        };
                        player.pausedTask = null;
                        player.manualStop = false;

                        await savePlayer(twitchId, player);
                        appendHostLog(
                            `!sift from ${username}: started "${task.name}" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );

                        if (player.linkedWebsimId) {
                            this.room.send({
                                type: 'state_update',
                                targetId: player.linkedWebsimId,
                                playerData: player
                            });
                        }
                    }
                }
            }
        } else if (lowerMsg === '!explore') {
            // Scavenging: Explore Ruins
            const scavSkill = SKILLS.scavenging;
            const task = scavSkill.tasks.find(t => t.id === 'sc_ruins');

            if (player.activeTask) {
                appendHostLog(`!explore from ${username} ignored: task already in progress (${player.activeTask.taskId}).`);
            } else if (!task) {
                appendHostLog(`!explore from ${username} failed: task definition missing (sc_ruins).`);
            } else {
                const totalXp = computeSkillXp(player, scavSkill.id);
                const levelInfo = getLevelInfo(totalXp);
                const playerLevel = levelInfo.level;

                if (playerLevel < (task.level || 1)) {
                    appendHostLog(
                        `!explore from ${username} denied: level ${playerLevel} < required ${task.level} for "${task.name}".`
                    );
                } else {
                    const totalAvailable = getAvailableEnergyCount(player);
                    if (totalAvailable <= 0) {
                        appendHostLog(`!explore from ${username} denied: no energy (pool empty and no active cell).`);
                    } else {
                        const hasActiveEnergy =
                            player.activeEnergy &&
                            (typeof player.activeEnergy.consumedMs === 'number'
                                ? player.activeEnergy.consumedMs < ONE_HOUR_MS
                                : true);

                        if (!hasActiveEnergy) {
                            if (player.energy.length > 0) {
                                player.energy.shift();
                                player.activeEnergy = { consumedMs: 0 };
                                appendHostLog(`Energy cell activated for ${username} (1h of active time).`);
                            } else {
                                appendHostLog(
                                    `!explore from ${username} denied: race condition left no stored energy.`
                                );
                                await savePlayer(twitchId, player);
                                this.refreshPlayerList();
                                return;
                            }
                        }

                        player.activeTask = {
                            taskId: task.id,
                            startTime: now,
                            duration: task.duration
                        };
                        player.pausedTask = null;
                        player.manualStop = false;

                        await savePlayer(twitchId, player);
                        appendHostLog(
                            `!explore from ${username}: started "${task.name}" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );

                        if (player.linkedWebsimId) {
                            this.room.send({
                                type: 'state_update',
                                targetId: player.linkedWebsimId,
                                playerData: player
                            });
                        }
                    }
                }
            }
        } else if (lowerMsg === '!salvage') {
            // Scavenging: Salvage Tech
            const scavSkill = SKILLS.scavenging;
            const task = scavSkill.tasks.find(t => t.id === 'sc_tech');

            if (player.activeTask) {
                appendHostLog(`!salvage from ${username} ignored: task already in progress (${player.activeTask.taskId}).`);
            } else if (!task) {
                appendHostLog(`!salvage from ${username} failed: task definition missing (sc_tech).`);
            } else {
                const totalXp = computeSkillXp(player, scavSkill.id);
                const levelInfo = getLevelInfo(totalXp);
                const playerLevel = levelInfo.level;

                if (playerLevel < (task.level || 1)) {
                    appendHostLog(
                        `!salvage from ${username} denied: level ${playerLevel} < required ${task.level} for "${task.name}".`
                    );
                } else {
                    const totalAvailable = getAvailableEnergyCount(player);
                    if (totalAvailable <= 0) {
                        appendHostLog(`!salvage from ${username} denied: no energy (pool empty and no active cell).`);
                    } else {
                        const hasActiveEnergy =
                            player.activeEnergy &&
                            (typeof player.activeEnergy.consumedMs === 'number'
                                ? player.activeEnergy.consumedMs < ONE_HOUR_MS
                                : true);

                        if (!hasActiveEnergy) {
                            if (player.energy.length > 0) {
                                player.energy.shift();
                                player.activeEnergy = { consumedMs: 0 };
                                appendHostLog(`Energy cell activated for ${username} (1h of active time).`);
                            } else {
                                appendHostLog(
                                    `!salvage from ${username} denied: race condition left no stored energy.`
                                );
                                await savePlayer(twitchId, player);
                                this.refreshPlayerList();
                                return;
                            }
                        }

                        player.activeTask = {
                            taskId: task.id,
                            startTime: now,
                            duration: task.duration
                        };
                        player.pausedTask = null;
                        player.manualStop = false;

                        await savePlayer(twitchId, player);
                        appendHostLog(
                            `!salvage from ${username}: started "${task.name}" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );

                        if (player.linkedWebsimId) {
                            this.room.send({
                                type: 'state_update',
                                targetId: player.linkedWebsimId,
                                playerData: player
                            });
                        }
                    }
                }
            }
        } else if (lowerMsg.startsWith('!fish') || lowerMsg.startsWith('!net') || lowerMsg.startsWith('!lure') || lowerMsg.startsWith('!harpoon')) {
            // Fishing commands:
            // !fish                 → highest fish by level
            // !fish shrimp          → Shrimp
            // !fish trout           → Trout
            // !fish shark           → Shark
            // Aliases:
            // !net shrimp           → Shrimp
            // !lure trout           → Trout
            // !harpoon shark        → Shark
            const parts = lowerMsg.split(/\s+/);
            const baseCmd = parts[0];
            const arg = (parts[1] || '').trim();

            const fishSkill = SKILLS.fishing;
            let requested = '';

            if (baseCmd === '!fish') {
                requested = arg; // shrimp / trout / shark / ''
            } else if (baseCmd === '!net') {
                requested = 'shrimp';
            } else if (baseCmd === '!lure') {
                requested = 'trout';
            } else if (baseCmd === '!harpoon') {
                requested = 'shark';
            }

            if (player.activeTask) {
                appendHostLog(`${baseCmd} from ${username} ignored: task already in progress (${player.activeTask.taskId}).`);
            } else {
                const totalXp = computeSkillXp(player, fishSkill.id);
                const levelInfo = getLevelInfo(totalXp);
                const playerLevel = levelInfo.level;

                let targetTask = null;

                if (!requested) {
                    // Highest fish they meet the level requirement for
                    const candidates = fishSkill.tasks
                        .filter(t => playerLevel >= (t.level || 1))
                        .sort((a, b) => (b.level || 1) - (a.level || 1));
                    targetTask = candidates[0] || null;
                } else if (requested === 'shrimp') {
                    targetTask = fishSkill.tasks.find(t => t.id === 'fi_shrimp') || null;
                } else if (requested === 'trout') {
                    targetTask = fishSkill.tasks.find(t => t.id === 'fi_trout') || null;
                } else if (requested === 'shark') {
                    targetTask = fishSkill.tasks.find(t => t.id === 'fi_shark') || null;
                } else {
                    appendHostLog(`${baseCmd} from ${username} ignored: unknown fish "${requested}".`);
                }

                if (!targetTask) {
                    appendHostLog(`${baseCmd} from ${username} failed: no eligible fishing task for level ${playerLevel}.`);
                } else if (playerLevel < (targetTask.level || 1)) {
                    appendHostLog(
                        `${baseCmd} from ${username} denied: level ${playerLevel} < required ${targetTask.level} for "${targetTask.name}".`
                    );
                } else {
                    const totalAvailable = getAvailableEnergyCount(player);
                    if (totalAvailable <= 0) {
                        appendHostLog(`${baseCmd} from ${username} denied: no energy (pool empty and no active cell).`);
                    } else {
                        const hasActiveEnergy =
                            player.activeEnergy &&
                            (typeof player.activeEnergy.consumedMs === 'number'
                                ? player.activeEnergy.consumedMs < ONE_HOUR_MS
                                : true);

                        if (!hasActiveEnergy) {
                            if (player.energy.length > 0) {
                                player.energy.shift();
                                player.activeEnergy = { consumedMs: 0 };
                                appendHostLog(`Energy cell activated for ${username} (1h of active time).`);
                            } else {
                                appendHostLog(
                                    `${baseCmd} from ${username} denied: race condition left no stored energy.`
                                );
                                await savePlayer(twitchId, player);
                                this.refreshPlayerList();
                                return;
                            }
                        }

                        player.activeTask = {
                            taskId: targetTask.id,
                            startTime: now,
                            duration: targetTask.duration
                        };
                        player.pausedTask = null;
                        player.manualStop = false;

                        await savePlayer(twitchId, player);
                        appendHostLog(
                            `${baseCmd} from ${username}: started "${targetTask.name}" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );

                        if (player.linkedWebsimId) {
                            this.room.send({
                                type: 'state_update',
                                targetId: player.linkedWebsimId,
                                playerData: player
                            });
                        }
                    }
                }
            }
        }

        // Update Twitch user list in dropdown
        this.refreshPlayerList();
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
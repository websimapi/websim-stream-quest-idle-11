export class NetworkManager {
    constructor(room, isHost, user) {
        this.room = room;
        this.isHost = isHost;
        this.user = user;
        this.tmiClient = null;
        this.pendingLinks = {}; // code -> { websimClientId, createdAt }

        this.onEnergyUpdate = null;
        this.onTaskUpdate = null;
        this.onLinkSuccess = null;
        this.onLinkCode = null;
        this.onStateUpdate = null;
        this.onPresenceUpdate = null;
        this.onPlayerListUpdate = null;

        this.initialize();
    }

    async initialize() {
// ... existing code ...
    }

    // --- HOST LOGIC ---

    connectTwitch(channelName) {
// ... existing code ...
    }

    generateLinkCode() {
// ... existing code ...
    }

    cleanupExpiredCodes() {
// ... existing code ...
    }

    async handleTwitchMessage(tags, message) {
        const twitchId = tags['user-id'];
        const username = tags['username'];
        const now = Date.now();

        // 1. Energy Logic
        let player = await getPlayer(twitchId);
        if (!player) {
            player = createNewPlayer(username, twitchId);
            appendHostLog(`New Twitch user detected: ${username} (${twitchId}).`);
        }

        // Check energy threshold (5 minutes)
        if (now - player.lastChatTime > 300000) { 
            if (player.energy.length < 12) {
                player.energy.push(now); // Add energy cell
                appendHostLog(`Energy +1 for ${username} (now ${player.energy.length}/12).`);
                // Notify if they are online via WebSim
                if (player.linkedWebsimId) {
                    this.room.send({
                        type: 'energy_update',
                        targetId: player.linkedWebsimId,
                        energy: player.energy
                    });
                }
            }
            player.lastChatTime = now;
            await savePlayer(twitchId, player);
        }

        // 2. Command Logic
        if (message.startsWith('!link ')) {
            const code = message.split(' ')[1];
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
        } else if (message.toLowerCase().startsWith('!chop')) {
            // Skill command: woodcutting
            const parts = message.trim().split(/\s+/);
            const arg = (parts[1] || '').toLowerCase();

            // Prevent overriding an active task
            if (player.activeTask) {
                appendHostLog(`!chop from ${username} ignored: task already in progress (${player.activeTask.taskId}).`);
            } else if (player.energy.length <= 0) {
                appendHostLog(`!chop from ${username} denied: no energy available.`);
            } else {
                // Determine which tree to chop
                const woodSkill = SKILLS.woodcutting;
                let targetTaskId = null;

                if (!arg || arg === '') {
                    // Highest available based on player level
                    const level = player.level || 1;
                    const candidates = woodSkill.tasks
                        .filter(t => level >= t.level)
                        .sort((a, b) => b.level - a.level);
                    if (candidates.length > 0) {
                        targetTaskId = candidates[0].id;
                    }
                } else if (arg === 'oak') {
                    const t = woodSkill.tasks.find(t => t.id === 'wc_oak');
                    if (t && (player.level || 1) >= t.level) targetTaskId = t.id;
                } else if (arg === 'willow') {
                    const t = woodSkill.tasks.find(t => t.id === 'wc_willow');
                    if (t && (player.level || 1) >= t.level) targetTaskId = t.id;
                } else if (arg === 'maple') {
                    const t = woodSkill.tasks.find(t => t.id === 'wc_maple');
                    if (t && (player.level || 1) >= t.level) targetTaskId = t.id;
                } else {
                    appendHostLog(`!chop from ${username} ignored: unknown tree "${arg}".`);
                }

                if (!targetTaskId) {
                    appendHostLog(`!chop from ${username} failed: no eligible woodcutting task for level ${player.level || 1}.`);
                } else {
                    const taskDef = woodSkill.tasks.find(t => t.id === targetTaskId);
                    if (!taskDef) {
                        appendHostLog(`!chop from ${username} failed: task definition missing (${targetTaskId}).`);
                    } else {
                        // Consume one energy and start the task
                        player.energy.shift();
                        player.activeTask = {
                            taskId: taskDef.id,
                            startTime: Date.now(),
                            duration: taskDef.duration
                        };

                        await savePlayer(twitchId, player);

                        appendHostLog(`!chop from ${username}: started "${taskDef.name}" (uses 1 energy, remaining ${player.energy.length}/12).`);

                        // If they're linked, notify their web client
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

    setupHostListeners() {
// ... existing code ...
    }
    
// ... existing code ...
}


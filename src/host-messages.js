import { savePlayer } from './db.js';
import { appendHostLog, ONE_HOUR_MS, getAvailableEnergyCount, normalizeActiveEnergy } from './network-common.js';
import { SKILLS } from './skills.js';
import { getLevelInfo, computeSkillXp } from './xp.js';

// Host-only message handler wiring (extracted from network-host.js)
export function installHostMessageHandler(networkManager) {
    const room = networkManager.room;

    room.onmessage = async (event) => {
        const data = event.data;
        const senderId = data.clientId; // WebSim client ID

        // Ignore directed messages not meant for this host client
        if (data.targetId && data.targetId !== room.clientId) return;

        // Host handles both host-specific and client-style messages

        if (data.type === 'link_code_generated') {
            appendHostLog(`Generated link code "${data.code}" for WebSim client ${senderId}.`);
            if (networkManager.onLinkCode) networkManager.onLinkCode(data.code);
            return;
        } else if (data.type === 'link_success') {
            // Store token locally (host can also be a linked client)
            if (data.token) {
                localStorage.setItem('sq_token', data.token);
            }
            appendHostLog(`Host received link_success for a client.`);
            if (networkManager.onLinkSuccess && data.playerData) networkManager.onLinkSuccess(data.playerData);
            return;
        } else if (data.type === 'sync_data' || data.type === 'state_update' || data.type === 'energy_update') {
            if (data.playerData && networkManager.onStateUpdate) {
                networkManager.onStateUpdate(data.playerData);
            }
            return;
        } else if (data.type === 'token_invalid') {
            // Host's local client token was rejected/expired
            localStorage.removeItem('sq_token');
            if (networkManager.onTokenInvalid) networkManager.onTokenInvalid();
            return;
        }

        if (data.type === 'request_link_code') {
            // Generate 6-character code
            const code = networkManager.generateLinkCode();
            networkManager.pendingLinks[code] = {
                websimClientId: senderId,
                createdAt: Date.now()
            };
            appendHostLog(`Link code "${code}" created for WebSim client ${senderId}.`);

            room.send({
                type: 'link_code_generated',
                targetId: senderId,
                code: code
            });
        } else if (data.type === 'sync_request') {
            // Verify token
            const player = await networkManager.validateToken(data.token);
            if (player) {
                // Update link if changed
                if (player.linkedWebsimId !== senderId) {
                    player.linkedWebsimId = senderId;
                    await savePlayer(player.twitchId, player);
                    appendHostLog(`Sync updated link for ${player.username} to WebSim client ${senderId}.`);
                }

                room.send({
                    type: 'sync_data',
                    targetId: senderId,
                    playerData: player
                });
            } else {
                appendHostLog(`sync_request from ${senderId} failed token validation (expired/invalid).`);
                room.send({
                    type: 'token_invalid',
                    targetId: senderId
                });
            }
        } else if (data.type === 'start_task') {
            const player = await networkManager.validateToken(data.token);
            if (player) {
                // Normalize legacy structures
                if (!Array.isArray(player.energy)) player.energy = [];
                if (!player.inventory) player.inventory = {};
                if (!player.skills) player.skills = {};
                if (player.activeEnergy && !player.activeEnergy.startTime && typeof player.activeEnergy.consumedMs !== 'number') {
                    player.activeEnergy = null;
                }
                // Normalize new persisted stop/start fields
                if (typeof player.manualStop !== 'boolean') player.manualStop = false;
                if (player.pausedTask && !player.pausedTask.taskId) player.pausedTask = null;

                // Clear expired active energy if needed
                await normalizeActiveEnergy(player);

                // Find skill/task definition for level validation
                let skillId = null;
                let taskDef = null;
                for (const [sid, skill] of Object.entries(SKILLS)) {
                    const found = skill.tasks.find(t => t.id === data.taskId);
                    if (found) {
                        skillId = sid;
                        taskDef = found;
                        break;
                    }
                }

                if (!taskDef || !skillId) {
                    appendHostLog(`Task start denied: unknown taskId "${data.taskId}" from client ${senderId}.`);
                    return;
                }

                // Compute player's level for this skill
                const totalXp = computeSkillXp(player, skillId);
                const levelInfo = getLevelInfo(totalXp);
                const requiredLevel = taskDef.level || 1;

                if (levelInfo.level < requiredLevel) {
                    appendHostLog(
                        `Task start denied for ${player.username}: level ${levelInfo.level} < required ${requiredLevel} for "${taskDef.name}".`
                    );
                    // Optionally could notify client; for now just deny
                    return;
                }

                const now = Date.now();
                const totalAvailable = getAvailableEnergyCount(player);
                if (totalAvailable <= 0) {
                    appendHostLog(`Task start denied for ${player.username}: no energy (pool empty and no active cell).`);
                    // Optionally, notify the client of denial
                } else {
                    // If no active energy cell, activate one by consuming stored energy
                    const hasActiveEnergy =
                        player.activeEnergy &&
                        (typeof player.activeEnergy.consumedMs === 'number'
                            ? player.activeEnergy.consumedMs < ONE_HOUR_MS
                            : true);

                    if (!hasActiveEnergy) {
                        if (player.energy.length > 0) {
                            player.energy.shift(); // consume one stored energy
                            // New energy model: track consumedMs; it only increases while active
                            player.activeEnergy = { consumedMs: 0 };
                            appendHostLog(`Energy cell activated for ${player.username} (1h of active time).`);
                        } else {
                            // This should not happen due to totalAvailable > 0, but guard anyway
                            appendHostLog(
                                `Task start denied for ${player.username}: race condition left no stored energy.`
                            );
                            await savePlayer(player.twitchId, player);
                            return;
                        }
                    }

                    // Set Task (uses current active energy cell, but does not consume additional charges)
                    player.activeTask = {
                        taskId: data.taskId,
                        startTime: now,
                        duration: data.duration
                    };

                    // Clear any paused/idle state when starting a new task
                    player.pausedTask = null;
                    player.manualStop = false;

                    await savePlayer(player.twitchId, player);
                    appendHostLog(`Task "${data.taskId}" started for ${player.username}.`);

                    // Broadcast update
                    room.send({
                        type: 'state_update',
                        targetId: senderId,
                        playerData: player
                    });
                }
            } else {
                appendHostLog(`start_task from ${senderId} failed token validation (expired/invalid).`);
                room.send({
                    type: 'token_invalid',
                    targetId: senderId
                });
            }
        } else if (data.type === 'stop_task') {
            const player = await networkManager.validateToken(data.token);
            if (player) {
                const stoppedTaskId = player.activeTask?.taskId || 'unknown';
                appendHostLog(`Task "${stoppedTaskId}" stopped for ${player.username}.`);

                // Persist paused/idle state so all peers see "Idle ~ TASKNAME"
                if (player.activeTask) {
                    player.pausedTask = {
                        taskId: player.activeTask.taskId,
                        duration: player.activeTask.duration
                    };
                }
                // Stopping task puts user into idle; energy drain is handled by the background loop
                player.activeTask = null;
                player.manualStop = true;

                await savePlayer(player.twitchId, player);
                room.send({
                    type: 'state_update',
                    targetId: senderId,
                    playerData: player
                });
            } else {
                appendHostLog(`stop_task from ${senderId} failed token validation (expired/invalid).`);
                room.send({
                    type: 'token_invalid',
                    targetId: senderId
                });
            }
        } else if (data.type === 'client_delink') {
            // A client (or host) is requesting to de-link their Twitch account
            const player = await networkManager.validateToken(data.token);
            if (player) {
                appendHostLog(`De-link requested for ${player.username}. Clearing linked WebSim client.`);
                player.linkedWebsimId = null;
                await savePlayer(player.twitchId, player);

                // Tell that client their token is no longer valid
                room.send({
                    type: 'token_invalid',
                    targetId: senderId
                });

                // Refresh Twitch user list so UI reflects de-link
                networkManager.refreshPlayerList();
            } else {
                appendHostLog(`client_delink from ${senderId} failed token validation (expired/invalid).`);
            }
        }
    };
}
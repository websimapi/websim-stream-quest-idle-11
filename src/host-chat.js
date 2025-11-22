import { savePlayer, getPlayer, createNewPlayer } from './db.js';
import { SKILLS } from './skills.js';
import { appendHostLog, ONE_HOUR_MS, getAvailableEnergyCount, normalizeActiveEnergy } from './network-common.js';
import { getLevelInfo, computeSkillXp } from './xp.js';

// Host-only Twitch chat command handling (extracted from NetworkManager.handleTwitchMessage)
export async function handleTwitchChat(networkManager, tags, message) {
    const room = networkManager.room;
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
                room.send({
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
        appendHostLog(`!link attempt by ${username} with code \"${code}\".`);
        networkManager.cleanupExpiredCodes();
        const entry = networkManager.pendingLinks[code];
        if (entry) {
            const websimClientId = entry.websimClientId;

            // Link them
            player.linkedWebsimId = websimClientId;
            await savePlayer(twitchId, player);

            // Generate "Token"
            const token = btoa(JSON.stringify({ twitchId, exp: now + (7 * 24 * 60 * 60 * 1000) }));

            // Inform Client
            room.send({
                type: 'link_success',
                targetId: websimClientId,
                token: token,
                playerData: player
            });

            delete networkManager.pendingLinks[code];
            appendHostLog(`Link success: ${username} ↔ WebSim client ${websimClientId}.`);
            console.log(`Linked ${username} to websim client ${websimClientId}`);
        } else {
            appendHostLog(`Link failed for ${username}: code \"${code}\" not found or expired.`);
        }
    } else if (lowerMsg.startsWith('!chop')) {
        // Woodcutting commands:
        // !chop            → highest tree available by level
        // !chop oak        → force Oak
        // !chop willow     → force Willow
        // !chop maple      → force Maple
        const parts = lowerMsg.split(/\\s+/);
        const arg = (parts[1] || '').trim();

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
            appendHostLog(`!chop from ${username} ignored: unknown tree \"${arg}\".`);
        }

        if (!targetTask) {
            appendHostLog(`!chop from ${username} failed: no eligible woodcutting task for level ${playerLevel}.`);
        } else if (playerLevel < (targetTask.level || 1)) {
            appendHostLog(
                `!chop from ${username} denied: level ${playerLevel} < required ${targetTask.level} for \"${targetTask.name}\".`
            );
        } else {
            const totalAvailable = getAvailableEnergyCount(player);
            if (totalAvailable <= 0) {
                appendHostLog(`!chop from ${username} denied: no energy (pool empty and no active cell).`);
            } else {
                const previousTaskId = player.activeTask?.taskId || null;

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
                        networkManager.refreshPlayerList();
                        return;
                    }
                }

                // Switch to the new task (or start fresh if none was running)
                player.activeTask = {
                    taskId: targetTask.id,
                    startTime: now,
                    duration: targetTask.duration
                };
                player.pausedTask = null;
                player.manualStop = false;

                await savePlayer(twitchId, player);

                if (previousTaskId && previousTaskId !== targetTask.id) {
                    appendHostLog(
                        `!chop from ${username}: switched from \"${previousTaskId}\" to \"${targetTask.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                    );
                } else if (previousTaskId && previousTaskId === targetTask.id) {
                    appendHostLog(
                        `!chop from ${username}: restarted \"${targetTask.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                    );
                } else {
                    appendHostLog(
                        `!chop from ${username}: started \"${targetTask.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                    );
                }

                if (player.linkedWebsimId) {
                    room.send({
                        type: 'state_update',
                        targetId: player.linkedWebsimId,
                        playerData: player
                    });
                }
            }
        }
    } else if (lowerMsg === '!sift') {
        // Scavenging: Sift Trash
        const scavSkill = SKILLS.scavenging;
        const task = scavSkill.tasks.find(t => t.id === 'sc_trash');

        if (!task) {
            appendHostLog(`!sift from ${username} failed: task definition missing (sc_trash).`);
        } else {
            const totalXp = computeSkillXp(player, scavSkill.id);
            const levelInfo = getLevelInfo(totalXp);
            const playerLevel = levelInfo.level;

            if (playerLevel < (task.level || 1)) {
                appendHostLog(
                    `!sift from ${username} denied: level ${playerLevel} < required ${task.level} for \"${task.name}\".`
                );
            } else {
                const totalAvailable = getAvailableEnergyCount(player);
                if (totalAvailable <= 0) {
                    appendHostLog(`!sift from ${username} denied: no energy (pool empty and no active cell).`);
                } else {
                    const previousTaskId = player.activeTask?.taskId || null;

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
                            networkManager.refreshPlayerList();
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

                    if (previousTaskId && previousTaskId !== task.id) {
                        appendHostLog(
                            `!sift from ${username}: switched from \"${previousTaskId}\" to \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    } else if (previousTaskId && previousTaskId === task.id) {
                        appendHostLog(
                            `!sift from ${username}: restarted \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    } else {
                        appendHostLog(
                            `!sift from ${username}: started \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    }

                    if (player.linkedWebsimId) {
                        room.send({
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

        if (!task) {
            appendHostLog(`!explore from ${username} failed: task definition missing (sc_ruins).`);
        } else {
            const totalXp = computeSkillXp(player, scavSkill.id);
            const levelInfo = getLevelInfo(totalXp);
            const playerLevel = levelInfo.level;

            if (playerLevel < (task.level || 1)) {
                appendHostLog(
                    `!explore from ${username} denied: level ${playerLevel} < required ${task.level} for \"${task.name}\".`
                );
            } else {
                const totalAvailable = getAvailableEnergyCount(player);
                if (totalAvailable <= 0) {
                    appendHostLog(`!explore from ${username} denied: no energy (pool empty and no active cell).`);
                } else {
                    const previousTaskId = player.activeTask?.taskId || null;

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
                            networkManager.refreshPlayerList();
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

                    if (previousTaskId && previousTaskId !== task.id) {
                        appendHostLog(
                            `!explore from ${username}: switched from \"${previousTaskId}\" to \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    } else if (previousTaskId && previousTaskId === task.id) {
                        appendHostLog(
                            `!explore from ${username}: restarted \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    } else {
                        appendHostLog(
                            `!explore from ${username}: started \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    }

                    if (player.linkedWebsimId) {
                        room.send({
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

        if (!task) {
            appendHostLog(`!salvage from ${username} failed: task definition missing (sc_tech).`);
        } else {
            const totalXp = computeSkillXp(player, scavSkill.id);
            const levelInfo = getLevelInfo(totalXp);
            const playerLevel = levelInfo.level;

            if (playerLevel < (task.level || 1)) {
                appendHostLog(
                    `!salvage from ${username} denied: level ${playerLevel} < required ${task.level} for \"${task.name}\".`
                );
            } else {
                const totalAvailable = getAvailableEnergyCount(player);
                if (totalAvailable <= 0) {
                    appendHostLog(`!salvage from ${username} denied: no energy (pool empty and no active cell).`);
                } else {
                    const previousTaskId = player.activeTask?.taskId || null;

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
                            networkManager.refreshPlayerList();
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

                    if (previousTaskId && previousTaskId !== task.id) {
                        appendHostLog(
                            `!salvage from ${username}: switched from \"${previousTaskId}\" to \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    } else if (previousTaskId && previousTaskId === task.id) {
                        appendHostLog(
                            `!salvage from ${username}: restarted \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    } else {
                        appendHostLog(
                            `!salvage from ${username}: started \"${task.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                        );
                    }

                    if (player.linkedWebsimId) {
                        room.send({
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
        const parts = lowerMsg.split(/\\s+/);
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
            appendHostLog(`${baseCmd} from ${username} ignored: unknown fish \"${requested}\".`);
        }

        if (!targetTask) {
            appendHostLog(`${baseCmd} from ${username} failed: no eligible fishing task for level ${playerLevel}.`);
        } else if (playerLevel < (targetTask.level || 1)) {
            appendHostLog(
                `${baseCmd} from ${username} denied: level ${playerLevel} < required ${targetTask.level} for \"${targetTask.name}\".`
            );
        } else {
            const totalAvailable = getAvailableEnergyCount(player);
            if (totalAvailable <= 0) {
                appendHostLog(`${baseCmd} from ${username} denied: no energy (pool empty and no active cell).`);
            } else {
                const previousTaskId = player.activeTask?.taskId || null;

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
                        networkManager.refreshPlayerList();
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

                if (previousTaskId && previousTaskId !== targetTask.id) {
                    appendHostLog(
                        `${baseCmd} from ${username}: switched from \"${previousTaskId}\" to \"${targetTask.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                    );
                } else if (previousTaskId && previousTaskId === targetTask.id) {
                    appendHostLog(
                        `${baseCmd} from ${username}: restarted \"${targetTask.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                    );
                } else {
                    appendHostLog(
                        `${baseCmd} from ${username}: started \"${targetTask.name}\" (using active energy cell, ${getAvailableEnergyCount(player)}/12 total).`
                    );
                }

                if (player.linkedWebsimId) {
                    room.send({
                        type: 'state_update',
                        targetId: player.linkedWebsimId,
                        playerData: player
                    });
                }
            }
        }
    }

    // Update Twitch user list in dropdown
    networkManager.refreshPlayerList();
}
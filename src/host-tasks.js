import { savePlayer, getAllPlayers } from './db.js';
import { SKILLS } from './skills.js';
import { appendHostLog, ONE_HOUR_MS } from './network-common.js';

// Helper: random integer between min and max inclusive
function randomInt(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

// Helper: resolve rewards for a completed task based on its reward definition
function resolveTaskRewards(taskDef) {
    const rewards = {};
    if (!taskDef || !taskDef.reward) return rewards;

    const r = taskDef.reward;

    if (r.type === 'quantity') {
        const qty = randomInt(r.min, r.max);
        if (qty > 0) {
            rewards[r.itemId] = (rewards[r.itemId] || 0) + qty;
        }
    } else if (r.type === 'lootTable' && Array.isArray(r.table)) {
        r.table.forEach(entry => {
            if (Math.random() <= (entry.chance ?? 0)) {
                const qty = randomInt(entry.min ?? 1, entry.max ?? 1);
                if (qty > 0) {
                    rewards[entry.itemId] = (rewards[entry.itemId] || 0) + qty;
                }
            }
        });
    }

    return rewards;
}

// Background loop: check all players for finished tasks and mark them complete
export function startTaskCompletionLoop(networkManager) {
    if (!networkManager.isHost || networkManager.taskCompletionInterval) return;

    const room = networkManager.room;

    networkManager.taskCompletionInterval = setInterval(async () => {
        try {
            const now = Date.now();
            const players = await getAllPlayers();

            for (const player of players) {
                // Ensure legacy safe structures
                if (!Array.isArray(player.energy)) player.energy = [];
                if (!player.inventory) player.inventory = {};
                if (!player.skills) player.skills = {};
                if (player.activeEnergy && !player.activeEnergy.startTime && typeof player.activeEnergy.consumedMs !== 'number') {
                    player.activeEnergy = null;
                }
                // Normalize new persisted stop/start fields
                if (typeof player.manualStop !== 'boolean') player.manualStop = false;
                if (player.pausedTask && !player.pausedTask.taskId) player.pausedTask = null;

                // Handle energy expiry and drain only while active
                if (player.activeEnergy) {
                    // New model: activeEnergy.consumedMs only increases while a task is active
                    if (typeof player.activeEnergy.consumedMs !== 'number') {
                        // Legacy fallback from old startTime model
                        if (player.activeEnergy.startTime) {
                            player.activeEnergy.consumedMs = Math.min(
                                ONE_HOUR_MS,
                                now - (player.activeEnergy.startTime || 0)
                            );
                        } else {
                            player.activeEnergy.consumedMs = 0;
                        }
                    }

                    if (player.activeTask) {
                        // Drain 1s of energy per loop while active
                        player.activeEnergy.consumedMs = Math.min(
                            ONE_HOUR_MS,
                            (player.activeEnergy.consumedMs || 0) + 1000
                        );
                    }

                    const consumed = player.activeEnergy.consumedMs || 0;
                    const expired = consumed >= ONE_HOUR_MS;

                    if (expired) {
                        appendHostLog(`Background: active energy expired for ${player.username}.`);
                        player.activeEnergy = null;

                        // If the player is still doing a task and has stored energy, auto-activate the next cell
                        if (player.activeTask && player.energy.length > 0) {
                            player.energy.shift(); // consume next stored energy
                            player.activeEnergy = { consumedMs: 0 };
                            appendHostLog(
                                `Background: new energy cell auto-activated for ${player.username} (1h of active time).`
                            );
                        }
                    }
                }

                const active = player.activeTask;
                const elapsed = active ? now - (active.startTime || 0) : 0;

                if (active && elapsed >= (active.duration || 0)) {
                    // Determine which skill this task belongs to and its definition
                    const taskId = active.taskId;
                    let skillId = null;
                    let taskDef = null;

                    for (const [sid, skill] of Object.entries(SKILLS)) {
                        const found = skill.tasks.find(t => t.id === taskId);
                        if (found) {
                            skillId = sid;
                            taskDef = found;
                            break;
                        }
                    }

                    const completedAt = now;

                    if (skillId) {
                        // Ensure skills/structure exists
                        if (!player.skills[skillId]) {
                            player.skills[skillId] = { tasks: {} };
                        }
                        if (!player.skills[skillId].tasks) {
                            player.skills[skillId].tasks = {};
                        }
                        if (!player.skills[skillId].tasks[taskId]) {
                            player.skills[skillId].tasks[taskId] = [];
                        }

                        // Resolve rewards and XP
                        const xpGained = taskDef?.xp ?? 0;
                        const rewards = resolveTaskRewards(taskDef);

                        // Update inventory
                        Object.entries(rewards).forEach(([itemId, qty]) => {
                            player.inventory[itemId] = (player.inventory[itemId] || 0) + qty;
                        });

                        // Append completion record
                        const completionRecord = {
                            completedAt,
                            xp: xpGained,
                            rewards
                        };

                        player.skills[skillId].tasks[taskId].push(completionRecord);

                        appendHostLog(
                            `Task "${taskId}" completed for ${player.username} at ${new Date(
                                completedAt
                            ).toLocaleTimeString()} (XP: ${xpGained}, Rewards: ${JSON.stringify(rewards)}).`
                        );
                    } else {
                        appendHostLog(
                            `Task "${taskId}" completed for ${player.username} but no matching skill was found.`
                        );
                    }

                    // Clear active task
                    player.activeTask = null;
                    // Auto-completed tasks should not leave a paused/idle state
                    player.pausedTask = null;
                    player.manualStop = false;
                }

                // Persist any changes (task completion or energy expiry)
                await savePlayer(player.twitchId, player);

                // If they are linked, notify their web client so UI updates
                if (player.linkedWebsimId) {
                    room.send({
                        type: 'state_update',
                        targetId: player.linkedWebsimId,
                        playerData: player
                    });
                }
            }
        } catch (err) {
            console.error('Error in task completion loop', err);
            appendHostLog(`Error in task completion loop: ${err?.message || err}`);
        }
    }, 1000); // check every second
}
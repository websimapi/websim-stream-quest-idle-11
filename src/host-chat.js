import { savePlayer, getPlayer, createNewPlayer } from './db.js';
import { appendHostLog, getAvailableEnergyCount, normalizeActiveEnergy } from './network-common.js';
import { handleWoodcuttingCommand, handleScavengingCommand, handleFishingCommand } from './host-chat-commands.js';

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
        // removed inline woodcutting (!chop) command handling (moved to handleWoodcuttingCommand)
        await handleWoodcuttingCommand(networkManager, player, twitchId, username, lowerMsg);
    } else if (lowerMsg === '!sift' || lowerMsg === '!explore' || lowerMsg === '!salvage') {
        // removed inline scavenging (!sift/!explore/!salvage) command handling (moved to handleScavengingCommand)
        await handleScavengingCommand(networkManager, player, twitchId, username, lowerMsg);
    } else if (lowerMsg.startsWith('!fish') || lowerMsg.startsWith('!net') || lowerMsg.startsWith('!lure') || lowerMsg.startsWith('!harpoon')) {
        // removed inline fishing (!fish/!net/!lure/!harpoon) command handling (moved to handleFishingCommand)
        await handleFishingCommand(networkManager, player, twitchId, username, lowerMsg);
    }

    // Update Twitch user list in dropdown
    networkManager.refreshPlayerList();
}
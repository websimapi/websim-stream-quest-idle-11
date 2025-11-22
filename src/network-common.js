import { savePlayer } from './db.js';

// Shared constants and helpers for network code

export const ONE_HOUR_MS = 60 * 60 * 1000;

// Helper: append log lines to the host console if present
export function appendHostLog(message) {
    const logEl = document.getElementById('host-console-log');
    if (!logEl) return;
    const line = document.createElement('div');
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${message}`;
    logEl.appendChild(line);
    // Trim to last 200 lines
    while (logEl.childElementCount > 200) {
        logEl.removeChild(logEl.firstChild);
    }
    logEl.scrollTop = logEl.scrollHeight;
}

// Helper to compute available energy cells (stored + active if not expired)
export function getAvailableEnergyCount(player) {
    if (!player) return 0;
    const now = Date.now();
    let active = 0;

    if (player.activeEnergy) {
        // New model: activeEnergy.consumedMs only increases while the player is active
        if (typeof player.activeEnergy.consumedMs === 'number') {
            if (player.activeEnergy.consumedMs < ONE_HOUR_MS) {
                active = 1;
            }
        } else if (player.activeEnergy.startTime) {
            // Legacy fallback for older records
            if (now - (player.activeEnergy.startTime || 0) < ONE_HOUR_MS) {
                active = 1;
            }
        }
    }

    const stored = Array.isArray(player.energy) ? player.energy.length : 0;
    return stored + active;
}

// Helper to ensure activeEnergy is cleared if expired (returns true if changed)
export async function normalizeActiveEnergy(player) {
    if (!player || !player.activeEnergy) return false;
    const now = Date.now();

    let expired = false;

    if (typeof player.activeEnergy.consumedMs === 'number') {
        if (player.activeEnergy.consumedMs >= ONE_HOUR_MS) {
            expired = true;
        }
    } else if (player.activeEnergy.startTime) {
        // Legacy behavior for old records
        if (now - (player.activeEnergy.startTime || 0) >= ONE_HOUR_MS) {
            expired = true;
        }
    }

    if (expired) {
        appendHostLog(`Active energy expired for ${player.username}.`);
        player.activeEnergy = null;
        await savePlayer(player.twitchId, player);
        return true;
    }

    return false;
}
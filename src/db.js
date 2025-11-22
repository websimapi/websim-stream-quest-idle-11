import { openDB } from 'idb';
import pako from 'pako';
import { SKILLS } from './skills.js'; // added import for skills definition

let DB_NAME = 'StreamQuestDB';
const STORE_NAME = 'players';

export function setDbChannel(channelName) {
    if (channelName) {
        // Sanitize to ensure valid db name characters
        const clean = channelName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (clean) {
            DB_NAME = `StreamQuestDB_${clean}`;
            console.log('Database context switched to:', DB_NAME);
        }
    }
}

// Initialize DB
export async function initDB() {
    return openDB(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'twitchId' });
            }
        },
    });
}

// Save player data (Compressed)
export async function savePlayer(twitchId, data) {
    const db = await initDB();
    const jsonString = JSON.stringify(data);
    const compressed = pako.deflate(jsonString);
    await db.put(STORE_NAME, { twitchId, data: compressed });
}

// Load player data (Decompressed)
export async function getPlayer(twitchId) {
    const db = await initDB();
    const record = await db.get(STORE_NAME, twitchId);
    
    if (!record) return null;

    try {
        const decompressed = pako.inflate(record.data, { to: 'string' });
        return JSON.parse(decompressed);
    } catch (e) {
        console.error("Error inflating data", e);
        return null;
    }
}

export async function getAllPlayers() {
    const db = await initDB();
    const records = await db.getAll(STORE_NAME);
    const players = [];
    for (const record of records) {
        try {
            const decompressed = pako.inflate(record.data, { to: 'string' });
            const data = JSON.parse(decompressed);
            players.push(data);
        } catch (e) {
            console.error("Error inflating player in list", e);
        }
    }
    return players;
}

export async function clearAllPlayers() {
    const db = await initDB();
    await db.clear(STORE_NAME);
}

export async function replaceAllPlayers(playersArray) {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await store.clear();

    for (const player of playersArray || []) {
        try {
            const jsonString = JSON.stringify(player);
            const compressed = pako.deflate(jsonString);
            await store.put({ twitchId: player.twitchId, data: compressed });
        } catch (e) {
            console.error('Error importing player', player?.twitchId, e);
        }
    }

    await tx.done;
}

export function createNewPlayer(username, twitchId) {
    // Initialize skills structure:
    // skills: {
    //   woodcutting: { tasks: { [taskId]: [completionRecord, ...] } },
    //   scavenging: { tasks: { ... } },
    //   fishing: { tasks: { ... } }
    // }
    const skills = {};
    Object.keys(SKILLS).forEach(skillId => {
        skills[skillId] = {
            tasks: {}
        };
    });

    return {
        username,
        twitchId,
        skills,
        inventory: {}, // itemId -> quantity
        energy: [], // Array of timestamps (stored/unactivated energy)
        lastChatTime: 0,
        activeTask: null, // { taskId, startTime, duration }
        activeEnergy: null, // { startTime } or { consumedMs }
        linkedWebsimId: null,
        // New: persisted stop/start idle state
        pausedTask: null,   // { taskId, duration } when user is in Idle ~ TASK mode
        manualStop: false   // true if user manually stopped, preventing auto-restart
    };
}
// Presence watcher (extracted from network-host.js)
export function setupPresenceWatcher(networkManager) {
    const room = networkManager.room;

    // Host tracks realtime Websim users
    room.subscribePresence(() => {
        if (!networkManager.onPresenceUpdate) return;
        const peers = Object.entries(room.peers || {}).map(([id, info]) => ({
            id,
            username: info.username
        }));
        networkManager.onPresenceUpdate(peers);
        // Also refresh Twitch users list so linked WebSim usernames stay up to date
        networkManager.refreshPlayerList();
    });

    // Initial fire
    if (networkManager.onPresenceUpdate) {
        const peers = Object.entries(room.peers || {}).map(([id, info]) => ({
            id,
            username: info.username
        }));
        networkManager.onPresenceUpdate(peers);
    }
}
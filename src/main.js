import { NetworkManager } from './network.js';
import { UIManager } from './ui.js';

async function init() {
    const project = await window.websim.getCurrentProject();
    const currentUser = await window.websim.getCurrentUser();
    const creator = await window.websim.getCreator();

    const isHost = currentUser.id === creator.id;

    const room = new WebsimSocket();
    await room.initialize();

    console.log(`Initializing Game. Role: ${isHost ? 'HOST' : 'CLIENT'}`);

    // Pass user info to network manager
    const network = new NetworkManager(room, isHost, currentUser);
    const ui = new UIManager(network, isHost);

    // Setup Host Specific UI
    if (isHost) {
        document.getElementById('host-controls').style.display = 'block';
        const hostConsole = document.getElementById('host-console-container');
        if (hostConsole) {
            hostConsole.style.display = 'flex';
        }
        // Host menu and auth overlay visibility handled in UIManager

        // Auto-connect to last used Twitch channel if available
        const savedChannel = localStorage.getItem('sq_host_channel');
        if (savedChannel) {
            const connected = network.connectTwitch(savedChannel);
            if (connected) {
                const statusEl = document.getElementById('tmi-status');
                if (statusEl) {
                    statusEl.innerText = "Status: Connected to " + savedChannel;
                    statusEl.style.color = "#4ade80";
                }
                // After auto-connect, attempt auto-sync with stored token
                const token = localStorage.getItem('sq_token');
                if (token) {
                    network.syncWithToken(token);
                }
            }
        }
    }

    // Attempt auto-sync with stored token
    const token = localStorage.getItem('sq_token');
    if (token && !isHost) {
        // Clients auto-sync immediately on load
        network.syncWithToken(token);
    }
}

init();
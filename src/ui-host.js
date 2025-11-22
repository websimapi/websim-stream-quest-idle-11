// Host-only UI logic split out of UIManager

import { replaceAllPlayers } from './db.js';

export function setupHostUI(uiManager) {
    const {
        network,
        hostUserMenu,
        hostUserBtn,
        hostUserDropdown,
        realtimeUsersList,
        twitchUsersList,
        exportDataBtn,
        importDataBtn,
        importDataInput
    } = uiManager;

    // Show host user menu
    if (hostUserMenu) {
        hostUserMenu.style.display = 'flex';
    }

    // Host dropdown interactions
    if (hostUserBtn && hostUserDropdown) {
        hostUserBtn.addEventListener('click', () => {
            const isOpen = hostUserDropdown.style.display === 'block';
            hostUserDropdown.style.display = isOpen ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!hostUserMenu) return;
            if (!hostUserMenu.contains(e.target)) {
                hostUserDropdown.style.display = 'none';
            }
        });
    }

    // Host export/import data controls
    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const players = await network.exportChannelData();
                const blob = new Blob([JSON.stringify(players, null, 2)], {
                    type: 'application/json'
                });

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const channel = localStorage.getItem('sq_host_channel') || 'channel';
                const date = new Date().toISOString().replace(/[:.]/g, '-');
                a.href = url;
                a.download = `streamquest_${channel}_players_${date}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Export failed', err);
            }
        });
    }

    if (importDataBtn && importDataInput) {
        importDataBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            importDataInput.click();
        });

        importDataInput.addEventListener('change', async (e) => {
            e.stopPropagation();
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const confirmOverride = window.confirm(
                'Importing will OVERWRITE all existing player data for this channel. Continue?'
            );
            if (!confirmOverride) {
                importDataInput.value = '';
                return;
            }

            try {
                const text = await file.text();
                const parsed = JSON.parse(text);

                if (!Array.isArray(parsed)) {
                    alert('Invalid import file: expected an array of players.');
                    importDataInput.value = '';
                    return;
                }

                await network.importChannelData(parsed, replaceAllPlayers);
                alert('Import complete. Player data has been replaced for this channel.');
            } catch (err) {
                console.error('Import failed', err);
                alert('Import failed. Check the console for details.');
            } finally {
                importDataInput.value = '';
            }
        });
    }

    // Hook host-specific callbacks
    network.onPresenceUpdate = (peers) => {
        renderRealtimeUsers(peers, realtimeUsersList);
    };

    network.onPlayerListUpdate = (players, peers) => {
        renderTwitchUsers(players, peers, twitchUsersList);
    };
}

export function renderRealtimeUsers(peers, listEl) {
    if (!listEl) return;
    listEl.innerHTML = '';
    peers.forEach(peer => {
        const li = document.createElement('li');
        li.textContent = peer.username || peer.id;
        listEl.appendChild(li);
    });
}

export function renderTwitchUsers(players, peers, listEl) {
    if (!listEl) return;
    listEl.innerHTML = '';
    players.forEach(player => {
        const li = document.createElement('li');
        const linked = player.linkedWebsimId ? 'linked' : 'unlinked';

        let linkedName = '';
        if (player.linkedWebsimId && peers && peers[player.linkedWebsimId]) {
            const peerInfo = peers[player.linkedWebsimId];
            linkedName = peerInfo.username || player.linkedWebsimId;
        }

        li.innerHTML = `
            <span class="user-name">${player.username}</span>
            <span class="user-meta">
                (${linked}${linkedName ? ' → ' + linkedName : ''})
            </span>
        `;
        listEl.appendChild(li);
    });
}
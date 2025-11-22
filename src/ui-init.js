import { findSkillByTaskId, findSkillByName, showSkillDetails } from './ui-skills.js';

export function initListeners(uiManager) {
    const connectBtn = document.getElementById('connect-twitch-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            const channel = document.getElementById('twitch-channel-input').value;
            if (channel) {
                uiManager.network.connectTwitch(channel);
                document.getElementById('tmi-status').innerText = 'Status: Connected to ' + channel;
                document.getElementById('tmi-status').style.color = '#4ade80';

                // After the host connects to a Twitch channel, attempt auto-sync
                const token = localStorage.getItem('sq_token');
                if (token) {
                    uiManager.network.syncWithToken(token);
                }
            }
        });
    }

    document.getElementById('stop-btn').addEventListener('click', () => {
        const stopBtn = document.getElementById('stop-btn');
        const labelEl = document.getElementById('task-label');
        const progressEl = document.getElementById('task-progress');

        // If we are currently in idle mode for a previous task, clicking acts as "Start"
        if (uiManager._isIdle && uiManager.state && uiManager.state.pausedTask) {
            const paused = uiManager.state.pausedTask;
            const taskDef = uiManager.getTaskDefById(paused.taskId);
            const duration = paused.duration || taskDef?.duration;

            if (duration && paused.taskId) {
                // UI hint immediately; authoritative state will come from host
                if (stopBtn) stopBtn.innerText = 'STOP';
                if (labelEl && taskDef) labelEl.innerText = taskDef.name;
                if (progressEl) progressEl.style.width = '0%';

                uiManager.network.startTask(paused.taskId, duration);
            }
            return;
        }

        // Normal behavior: going from active to idle; host will persist pausedTask/manualStop
        if (uiManager.state && uiManager.state.activeTask) {
            const currentTask = uiManager.state.activeTask;
            const taskDef = uiManager.getTaskDefById(currentTask.taskId);
            const taskName = taskDef ? taskDef.name : currentTask.taskId || 'Task';

            if (labelEl) {
                labelEl.innerText = `Idle ~ ${taskName}`;
            }
            if (progressEl) {
                progressEl.style.width = '0%';
            }
            if (stopBtn) {
                stopBtn.innerText = 'Start';
            }

            // Stop the local progress animation immediately
            uiManager.stopProgressLoop();
        }

        uiManager.network.stopTask();
    });

    // Top-right link button (host + client)
    if (uiManager.linkAccountBtn) {
        uiManager.linkAccountBtn.addEventListener('click', () => {
            uiManager.network.requestLinkCode();
            if (uiManager.authOverlay) {
                uiManager.authOverlay.style.display = 'flex';
            }
        });
    }

    // User dropdown interactions (both host and clients)
    if (uiManager.userInfoEl && uiManager.clientUserDropdown) {
        uiManager.userInfoEl.addEventListener('click', (e) => {
            // Avoid toggling when clicking inside the dropdown content
            if (uiManager.clientUserDropdown.contains(e.target)) return;
            const hasToken = !!localStorage.getItem('sq_token');
            if (!hasToken) return; // no dropdown when not linked
            const isOpen = uiManager.clientUserDropdown.style.display === 'block';
            uiManager.clientUserDropdown.style.display = isOpen ? 'none' : 'block';
        });

        document.addEventListener('click', (e) => {
            if (!uiManager.userInfoEl) return;
            if (!uiManager.userInfoEl.contains(e.target)) {
                uiManager.clientUserDropdown.style.display = 'none';
            }
        });
    }

    if (uiManager.clientDelinkBtn) {
        uiManager.clientDelinkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // De-Link for host or client: inform host, then clear token and reset UI
            uiManager.network.requestDelink();
            localStorage.removeItem('sq_token');
            if (uiManager.authOverlay) {
                uiManager.authOverlay.style.display = 'none';
            }
            if (uiManager.clientUserDropdown) {
                uiManager.clientUserDropdown.style.display = 'none';
            }
            uiManager.updateAuthUI();
        });
    }

    // Network callbacks
    uiManager.network.onLinkCode = (code) => {
        const codeSpan = document.getElementById('link-code');
        if (codeSpan) {
            codeSpan.innerText = code;
        }

        const copyStatusEl = document.getElementById('global-link-copy-status');

        // Copy to clipboard for convenience (host + client)
        if (navigator.clipboard) {
            const linkCommand = `!link ${code}`;
            navigator.clipboard
                .writeText(linkCommand)
                .then(() => {
                    if (copyStatusEl) {
                        copyStatusEl.innerText = 'Copied to Clipboard – Paste in Twitch Chat to link';
                        clearTimeout(uiManager._copyStatusTimeout);
                        uiManager._copyStatusTimeout = setTimeout(() => {
                            copyStatusEl.innerText = '';
                        }, 4000);
                    }
                })
                .catch(() => {
                    if (copyStatusEl) {
                        copyStatusEl.innerText = '';
                    }
                });
        }
    };

    uiManager.network.onLinkSuccess = (playerData) => {
        if (uiManager.authOverlay) {
            uiManager.authOverlay.style.display = 'none';
        }
        uiManager.updateState(playerData);
        uiManager.updateAuthUI();
    };

    uiManager.network.onStateUpdate = (playerData) => {
        uiManager.updateState(playerData);
        uiManager.updateAuthUI();
    };

    // When host tells us our token is invalid/expired, force re-link flow
    uiManager.network.onTokenInvalid = () => {
        if (uiManager.authOverlay) {
            uiManager.authOverlay.style.display = 'none';
        }
        uiManager.updateAuthUI();
    };

    // Host presence/player list callbacks are wired in setupHostUI
    // removed inline network.onPresenceUpdate and onPlayerListUpdate handlers {}
}
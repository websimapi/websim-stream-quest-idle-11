import { SKILLS } from './skills.js';
import { setupHostUI } from './ui-host.js';
import { renderSkillsList } from './ui-skills.js';
import { renderInventory } from './ui-inventory.js';
import { initListeners as initListenersImpl } from './ui-init.js';
import { updateState as updateStateImpl } from './ui-state.js';
import { startProgressLoop as startProgressLoopImpl, stopProgressLoop as stopProgressLoopImpl } from './ui-progress.js';

const ONE_HOUR_MS = 60 * 60 * 1000; // matches server-side energy duration

export class UIManager {
    constructor(networkManager, isHost = false) {
        this.network = networkManager;
        this.state = null;
        this.activeTaskInterval = null;
        this.isHost = isHost;
        this.currentEnergyStartTime = null; // legacy tracker, no longer used for timing
        // Local mirrors of persisted state for convenience
        this._manualStop = false; // mirrors playerData.manualStop
        this._lastTask = null;    // mirrors playerData.pausedTask or activeTask
        this._isIdle = false;     // derived from playerData.pausedTask

        // Elements
        this.skillsList = document.getElementById('skills-list');
        this.authOverlay = document.getElementById('auth-overlay');
        this.skillDetails = document.getElementById('skill-details');
        this.activeTaskContainer = document.getElementById('active-task-container');
        this.energyCount = document.getElementById('energy-count');
        this.energyBarFill = document.getElementById('energy-cell-bar');
        this.energyBarBg = document.getElementById('energy-cell-bar-bg');
        this.usernameDisplay = document.getElementById('username');
        this.userAvatar = document.getElementById('user-avatar');
        this.linkAccountBtn = document.getElementById('link-account-btn');
        this.inventoryList = document.getElementById('inventory-list');

        // Host-specific elements
        this.hostUserMenu = document.getElementById('host-user-menu');
        this.hostUserBtn = document.getElementById('host-user-btn');
        this.hostUserDropdown = document.getElementById('host-user-dropdown');
        this.realtimeUsersList = document.getElementById('realtime-users-list');
        this.twitchUsersList = document.getElementById('twitch-users-list');

        // Host data export/import controls
        this.exportDataBtn = document.getElementById('export-data-btn');
        this.importDataBtn = document.getElementById('import-data-btn');
        this.importDataInput = document.getElementById('import-data-input');

        // Client user dropdown elements (also used by host now)
        this.userInfoEl = document.getElementById('user-info');
        this.clientUserDropdown = document.getElementById('client-user-dropdown');
        this.clientDelinkBtn = document.getElementById('client-delink-btn');

        // Pre-fill host channel if saved
        const savedChannel = localStorage.getItem('sq_host_channel');
        const channelInput = document.getElementById('twitch-channel-input');
        if (savedChannel && channelInput) {
            channelInput.value = savedChannel;
        }

        // Host UI visibility and wiring
        if (this.isHost) {
            setupHostUI(this);
        }

        this.initListeners();
        renderSkillsList(this);
        this.updateAuthUI();
    }

    // Helper: compute available energy from player state
    computeEnergyCount(playerData) {
        if (!playerData) return 0;
        const now = Date.now();
        let active = 0;

        if (playerData.activeEnergy) {
            if (typeof playerData.activeEnergy.consumedMs === 'number') {
                if (playerData.activeEnergy.consumedMs < ONE_HOUR_MS) {
                    active = 1;
                }
            } else if (playerData.activeEnergy.startTime) {
                if (now - (playerData.activeEnergy.startTime || 0) < ONE_HOUR_MS) {
                    active = 1;
                }
            }
        }

        const stored = Array.isArray(playerData.energy) ? playerData.energy.length : 0;
        return stored + active;
    }

    // Helper: get task definition by ID
    getTaskDefById(taskId) {
        if (!taskId) return null;
        for (const skill of Object.values(SKILLS)) {
            const t = skill.tasks.find((t) => t.id === taskId);
            if (t) return t;
        }
        return null;
    }

    initListeners() {
        initListenersImpl(this);
    }

    updateAuthUI() {
        const hasToken = !!localStorage.getItem('sq_token');

        if (this.linkAccountBtn) {
            this.linkAccountBtn.style.display = hasToken ? 'none' : 'inline-block';
        }

        if (this.userAvatar) {
            this.userAvatar.style.display = hasToken ? 'block' : 'none';
        }
        if (this.usernameDisplay) {
            this.usernameDisplay.style.display = hasToken ? 'inline-block' : 'none';
            if (!hasToken) {
                this.usernameDisplay.innerText = 'Guest';
            }
        }

        // Hide dropdown when not linked
        if (!hasToken && this.clientUserDropdown) {
            this.clientUserDropdown.style.display = 'none';
        }
    }

    updateState(playerData) {
        updateStateImpl(this, playerData);
    }

    startProgressLoop(taskData) {
        startProgressLoopImpl(this, taskData);
    }

    stopProgressLoop() {
        stopProgressLoopImpl(this);
    }
}
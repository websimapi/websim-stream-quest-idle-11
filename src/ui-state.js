import { SKILLS } from './skills.js';
import { renderInventory } from './ui-inventory.js';
import { findSkillByTaskId, findSkillByName, showSkillDetails, renderSkillsList } from './ui-skills.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function updateState(uiManager, playerData) {
    const prevActiveTask = uiManager.state ? uiManager.state.activeTask : null;
    uiManager.state = playerData;

    // Mirror persisted stop/start info into local helpers
    uiManager._manualStop = !!playerData.manualStop;
    uiManager._isIdle = !!playerData.pausedTask;
    uiManager._lastTask = playerData.pausedTask || playerData.activeTask || uiManager._lastTask;

    // Update User Info
    if (uiManager.usernameDisplay && playerData.username) {
        uiManager.usernameDisplay.innerText = playerData.username;
    }

    // Update Energy (stored + active cell)
    const energyCount = uiManager.computeEnergyCount(playerData);
    uiManager.energyCount.innerText = `${energyCount}/12`;

    // Determine if we have an active energy cell (used for auto-restart + UI behavior)
    const now = Date.now();
    const hasActiveEnergy =
        playerData.activeEnergy &&
        (
            typeof playerData.activeEnergy.consumedMs === 'number'
                ? playerData.activeEnergy.consumedMs < ONE_HOUR_MS
                : now - (playerData.activeEnergy.startTime || 0) < ONE_HOUR_MS
        );

    // New: detect if we are about to auto-restart the previous task
    const willAutoRestart =
        hasActiveEnergy &&
        prevActiveTask &&
        !playerData.activeTask &&
        !uiManager._manualStop;

    // Update energy cell drain bar (percent + visual state)
    if (uiManager.energyBarFill && uiManager.energyBarBg) {
        const ae = playerData.activeEnergy;
        if (ae && hasActiveEnergy) {
            let consumedMs;

            if (typeof ae.consumedMs === 'number') {
                consumedMs = ae.consumedMs;
            } else if (ae.startTime && playerData.activeTask) {
                // Legacy approximation if we still have an old-style startTime
                consumedMs = Math.max(0, Math.min(ONE_HOUR_MS, now - (ae.startTime || 0)));
            } else {
                consumedMs = 0;
            }

            let remainingPct = 100 - (consumedMs / ONE_HOUR_MS) * 100;
            if (remainingPct < 0) remainingPct = 0;
            if (remainingPct > 100) remainingPct = 100;
            uiManager.energyBarFill.style.width = `${remainingPct}%`;

            // Treat the bar as "draining" while a task is running OR
            // during the brief auto-restart window to avoid a visual freeze.
            const isDraining = !!(hasActiveEnergy && (playerData.activeTask || willAutoRestart));

            // Toggle classes for visual state
            uiManager.energyBarBg.classList.toggle('draining', isDraining);
            uiManager.energyBarBg.classList.toggle('idle', !isDraining);
            uiManager.energyBarFill.classList.toggle('draining', isDraining);
            uiManager.energyBarFill.classList.toggle('idle', !isDraining);
        } else {
            // No active energy
            uiManager.energyBarFill.style.width = '0%';
            uiManager.energyBarBg.classList.remove('draining', 'idle');
            uiManager.energyBarFill.classList.remove('draining', 'idle');
        }
    }

    // Auto-restart last task while energy cell is active (only when we didn't manually stop)
    if (hasActiveEnergy && prevActiveTask && !playerData.activeTask && !uiManager._manualStop) {
        const taskId = prevActiveTask.taskId;
        let duration = prevActiveTask.duration;

        if (!duration) {
            // Fallback: look up duration from SKILLS if missing on legacy data
            for (const skill of Object.values(SKILLS)) {
                const t = skill.tasks.find((t) => t.id === taskId);
                if (t) {
                    duration = t.duration;
                    break;
                }
            }
        }

        if (taskId && duration) {
            // Start the next iteration immediately and keep UI visible;
            // we'll get a fresh state_update for the new task.
            uiManager.network.startTask(taskId, duration);
            return;
        }
    } else if (!playerData.activeTask && !hasActiveEnergy) {
        // If there is no active task and no active energy, clear any manual-stop suppression
        uiManager._manualStop = false;
        uiManager._isIdle = false;
    }

    // Update Active Task UI
    const shouldShowTaskHeader = !!(playerData.activeTask || hasActiveEnergy || prevActiveTask);
    uiManager.activeTaskContainer.style.display = shouldShowTaskHeader ? 'flex' : 'none';

    const stopBtn = document.getElementById('stop-btn');

    if (playerData.activeTask) {
        // Track the current task as the last task
        uiManager._lastTask = { ...playerData.activeTask };
        uiManager._isIdle = false;
        if (stopBtn) stopBtn.innerText = 'STOP';

        // Only restart the progress loop if the task actually changed
        const taskChanged =
            !prevActiveTask ||
            prevActiveTask.taskId !== playerData.activeTask.taskId ||
            prevActiveTask.startTime !== playerData.activeTask.startTime ||
            prevActiveTask.duration !== playerData.activeTask.duration;

        if (taskChanged) {
            uiManager.startProgressLoop(playerData.activeTask);
        }

        // Update Buttons in current view
        if (uiManager.skillDetails.style.display !== 'none') {
            // Refresh grid to update disabled states
            const activeSkill = findSkillByTaskId(playerData.activeTask.taskId);
            if (activeSkill) {
                const currentTitle = document.getElementById('detail-name').innerText;
                const skillOfCurrentView = findSkillByName(currentTitle);
                if (skillOfCurrentView) showSkillDetails(uiManager, skillOfCurrentView);
            }
        }
    } else {
        // No active task: if we also have no active energy, fully reset UI;
        // otherwise keep the header visible and the bar frozen.
        if (!hasActiveEnergy) {
            uiManager.stopProgressLoop();

            // Refresh grid to re-enable buttons
            const currentTitle = document.getElementById('detail-name').innerText;
            const skillOfCurrentView = findSkillByName(currentTitle);
            if (skillOfCurrentView) showSkillDetails(uiManager, skillOfCurrentView);
        } else if (uiManager._isIdle && uiManager.state && uiManager.state.pausedTask) {
            // When idle for a specific task, ensure the header text/button reflect idle state
            const labelEl = document.getElementById('task-label');
            const taskDef = uiManager.getTaskDefById(uiManager.state.pausedTask.taskId);
            const taskName = taskDef ? taskDef.name : uiManager.state.pausedTask.taskId || 'Task';
            if (labelEl) {
                labelEl.innerText = `Idle ~ ${taskName}`;
            }
            if (stopBtn) stopBtn.innerText = 'Start';
        }
    }

    // Update skills list (levels and progress bars)
    renderSkillsList(uiManager);

    // Update inventory panel
    renderInventory(uiManager.inventoryList, playerData);
}
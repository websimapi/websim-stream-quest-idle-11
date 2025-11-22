import { SKILLS } from './skills.js';

export function startProgressLoop(uiManager, taskData) {
    stopProgressLoop(uiManager);

    // Find Task Info
    let taskDef = null;
    for (const s of Object.values(SKILLS)) {
        const t = s.tasks.find((t) => t.id === taskData.taskId);
        if (t) {
            taskDef = t;
            break;
        }
    }

    if (!taskDef) return;

    document.getElementById('task-label').innerText = taskDef.name;
    const fill = document.getElementById('task-progress');

    uiManager.activeTaskInterval = setInterval(() => {
        const now = Date.now();
        const elapsed = now - taskData.startTime;
        let pct = (elapsed / taskData.duration) * 100;

        if (pct >= 100) {
            pct = 100;
        }

        fill.style.width = `${pct}%`;
    }, 100);
}

export function stopProgressLoop(uiManager) {
    if (uiManager.activeTaskInterval) {
        clearInterval(uiManager.activeTaskInterval);
        uiManager.activeTaskInterval = null;
    }
    const fill = document.getElementById('task-progress');
    if (fill) {
        fill.style.width = '0%';
    }
}
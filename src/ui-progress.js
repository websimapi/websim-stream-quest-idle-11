import { SKILLS } from './skills.js';

export function startProgressLoop(uiManager, taskData) {
    stopProgressLoop(uiManager);

    // Find Task Info
    let taskDef = null;
    let owningSkill = null;

    for (const skill of Object.values(SKILLS)) {
        const t = skill.tasks.find((t) => t.id === taskData.taskId);
        if (t) {
            taskDef = t;
            owningSkill = skill;
            break;
        }
    }

    if (!taskDef) return;

    document.getElementById('task-label').innerText = taskDef.name;

    // Update the active task icon to match the skill's icon
    const taskIconEl = document.getElementById('task-icon');
    if (taskIconEl && owningSkill && owningSkill.icon) {
        taskIconEl.src = owningSkill.icon;
        taskIconEl.alt = owningSkill.name;
    }

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
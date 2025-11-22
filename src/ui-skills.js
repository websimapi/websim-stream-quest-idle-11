import { SKILLS } from './skills.js';
import { getLevelInfo, computeSkillXp } from './xp.js';

export function renderSkillsList(uiManager) {
    const { skillsList, state } = uiManager;
    if (!skillsList) return;

    skillsList.innerHTML = '';
    Object.values(SKILLS).forEach(skill => {
        const div = document.createElement('div');
        div.className = 'skill-item';

        const totalXp = computeSkillXp(state, skill.id);
        const levelInfo = getLevelInfo(totalXp);
        const progressPct = Math.round(levelInfo.progress * 100);

        div.innerHTML = `
                <img src="${skill.icon}" alt="${skill.name}">
                <div class="skill-text">
                    <div class="skill-name-row">
                        <span class="skill-name">${skill.name}</span>
                        <span class="skill-level-label">Lv ${levelInfo.level}</span>
                    </div>
                    <div class="skill-xp-bar">
                        <div class="skill-xp-fill" style="width:${progressPct}%;"></div>
                    </div>
                </div>
            `;
        div.onclick = () => showSkillDetails(uiManager, skill);
        skillsList.appendChild(div);
    });
}

export function showSkillDetails(uiManager, skill) {
    const { skillDetails, state, computeEnergyCount } = uiManager;
    if (!skillDetails) return;

    skillDetails.style.display = 'block';
    document.getElementById('detail-icon').src = skill.icon;
    document.getElementById('detail-name').innerText = skill.name;
    document.getElementById('detail-desc').innerText = skill.description;

    const grid = document.getElementById('task-grid');
    grid.innerHTML = '';

    // Compute player's current level for this skill
    const totalXp = computeSkillXp(state, skill.id);
    const levelInfo = getLevelInfo(totalXp);
    const playerLevel = levelInfo.level;

    skill.tasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'task-card';

        const hasEnergy = state && computeEnergyCount(state) > 0;
        const isBusy = state && state.activeTask;
        const isThisActive = isBusy && state.activeTask.taskId === task.id;
        const requiredLevel = task.level || 1;
        const hasRequiredLevel = playerLevel >= requiredLevel;

        card.innerHTML = `
                <h4>${task.name}</h4>
                <p>Time: ${task.duration / 1000}s</p>
                <p>XP: ${task.xp}</p>
                <p>Level Req: ${requiredLevel}</p>
            `;

        const btn = document.createElement('button');
        // Label logic: active task shows "In Progress", locked tasks show requirement, others show "Start"
        if (isThisActive) {
            btn.innerText = 'In Progress';
        } else if (!hasRequiredLevel) {
            btn.innerText = `Locked (Lv ${requiredLevel})`;
        } else {
            btn.innerText = 'Start';
        }

        // Disable when no energy (and not already active) or level requirement not met
        if ((!hasEnergy && !isThisActive) || !hasRequiredLevel) {
            btn.disabled = true;
            if (!hasEnergy && hasRequiredLevel && !isThisActive) {
                btn.innerText = 'No Energy';
            }
        }

        btn.onclick = () => {
            // Do nothing if this task is already active or level is insufficient
            if (isThisActive || !hasRequiredLevel) return;

            // If another task is currently running, stop it first
            if (isBusy && state.activeTask.taskId !== task.id) {
                uiManager.network.stopTask();
            }

            // Start the requested task (host will validate energy and level)
            uiManager.network.startTask(task.id, task.duration);
        };

        card.appendChild(btn);
        grid.appendChild(card);
    });
}

export function findSkillByTaskId(taskId) {
    return Object.values(SKILLS).find(s => s.tasks.some(t => t.id === taskId));
}

export function findSkillByName(name) {
    return Object.values(SKILLS).find(s => s.name === name);
}


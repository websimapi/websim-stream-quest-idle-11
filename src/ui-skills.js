import { SKILLS } from './skills.js';

// XP scaling parameters for skills
const XP_BASE = 50;
const XP_ALPHA = 1.75;
const XP_BETA = 0.02;

// XP needed for a single level (not cumulative)
function xpForLevel(level) {
    if (level <= 0) return 0;
    return XP_BASE * Math.pow(level, XP_ALPHA) * (1 + level * XP_BETA);
}

// Given total accumulated XP, compute level and progress within current level
function getLevelInfo(totalXp) {
    let level = 1;
    let xpRemaining = totalXp || 0;

    // Subtract per-level requirements until we can't afford the next level
    while (true) {
        const req = xpForLevel(level);
        if (xpRemaining >= req) {
            xpRemaining -= req;
            level++;
        } else {
            break;
        }
    }

    const nextReq = xpForLevel(level) || 1;
    const progress = Math.max(0, Math.min(1, xpRemaining / nextReq));

    return {
        level,
        progress,
        currentXpInLevel: xpRemaining,
        xpForNextLevel: nextReq
    };
}

// Sum total XP for a given skill from completion records
function computeSkillXp(playerData, skillId) {
    if (!playerData || !playerData.skills || !playerData.skills[skillId]) return 0;
    const skillData = playerData.skills[skillId];
    const tasks = skillData.tasks || {};
    let total = 0;

    Object.values(tasks).forEach(records => {
        if (!Array.isArray(records)) return;
        records.forEach(rec => {
            if (rec && typeof rec.xp === 'number') {
                total += rec.xp;
            }
        });
    });

    return total;
}

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


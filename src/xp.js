export const XP_BASE = 50;
export const XP_ALPHA = 1.75;
export const XP_BETA = 0.02;

// XP needed for a single level (not cumulative)
export function xpForLevel(level) {
    if (level <= 0) return 0;
    return XP_BASE * Math.pow(level, XP_ALPHA) * (1 + level * XP_BETA);
}

// Given total accumulated XP, compute level and progress within current level
export function getLevelInfo(totalXp) {
    let level = 1;
    let xpRemaining = totalXp || 0;

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
export function computeSkillXp(playerData, skillId) {
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
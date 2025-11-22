// Friendly names for inventory items
export const ITEM_NAMES = {
    log_oak: 'Oak Logs',
    log_willow: 'Willow Logs',
    log_maple: 'Maple Logs',
    fish_shrimp: 'Shrimp',
    fish_trout: 'Trout',
    fish_shark: 'Shark',
    scrap_metal: 'Scrap Metal',
    torn_cloth: 'Torn Cloth',
    bottle_caps: 'Bottle Caps',
    ancient_scrap: 'Ancient Scrap',
    old_gears: 'Old Gears',
    mysterious_orb: 'Mysterious Orb',
    circuit_board: 'Circuit Board',
    power_core: 'Power Core',
    broken_chip: 'Broken Chip'
};

// Icon paths for inventory items
export const ITEM_ICONS = {
    log_oak: 'item_log_oak.png',
    log_willow: 'item_log_willow.png',
    log_maple: 'item_log_maple.png',
    fish_shrimp: 'item_fish_shrimp.png',
    fish_trout: 'item_fish_trout.png',
    fish_shark: 'item_fish_shark.png',
    scrap_metal: 'item_scrap_metal.png',
    torn_cloth: 'item_torn_cloth.png',
    bottle_caps: 'item_bottle_caps.png',
    ancient_scrap: 'item_ancient_scrap.png',
    old_gears: 'item_old_gears.png',
    mysterious_orb: 'item_mysterious_orb.png',
    circuit_board: 'item_circuit_board.png',
    power_core: 'item_power_core.png',
    broken_chip: 'broken_chip.png'
};

export function renderInventory(inventoryListEl, playerData) {
    if (!inventoryListEl) return;
    inventoryListEl.innerHTML = '';

    const inv = playerData?.inventory || {};
    const entries = Object.entries(inv).filter(([, qty]) => qty > 0);

    if (entries.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'inventory-empty';
        emptyDiv.textContent = 'Empty';
        inventoryListEl.appendChild(emptyDiv);
        return;
    }

    // Ensure grid styling is applied
    inventoryListEl.classList.add('inventory-list');

    // Sort items alphabetically by id for consistent layout
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    entries.forEach(([itemId, qty]) => {
        const slot = document.createElement('div');
        slot.className = 'inventory-item';

        const displayName = ITEM_NAMES[itemId] || itemId;
        // Attach the name for accessibility and native hover tooltip
        slot.dataset.name = displayName;
        slot.setAttribute('aria-label', displayName);
        slot.title = displayName;

        const iconPath = ITEM_ICONS[itemId] || '';
        if (iconPath) {
            const img = document.createElement('img');
            img.src = iconPath;
            img.alt = displayName;
            slot.appendChild(img);
        } else {
            // Fallback: show first letter if no icon found
            const span = document.createElement('span');
            span.textContent = displayName.charAt(0).toUpperCase();
            slot.appendChild(span);
        }

        const qtyBadge = document.createElement('div');
        qtyBadge.className = 'inventory-qty';
        qtyBadge.textContent = qty;
        slot.appendChild(qtyBadge);

        inventoryListEl.appendChild(slot);
    });
}
export const SKILLS = {
    woodcutting: {
        id: 'woodcutting',
        name: 'Woodcutting',
        description: 'Chop trees to gather logs for construction and firemaking.',
        icon: 'woodcutting_icon.png',
        tasks: [
            { 
                id: 'wc_oak', 
                name: 'Chop Oak', 
                level: 1, 
                duration: 5000, 
                xp: 10,
                reward: {
                    type: 'quantity',
                    itemId: 'log_oak',
                    min: 1,
                    max: 3
                }
            },
            { 
                id: 'wc_willow', 
                name: 'Chop Willow', 
                level: 30, 
                duration: 8000, 
                xp: 25,
                reward: {
                    type: 'quantity',
                    itemId: 'log_willow',
                    min: 1,
                    max: 3
                }
            },
            { 
                id: 'wc_maple', 
                name: 'Chop Maple', 
                level: 40, 
                duration: 12000, 
                xp: 45,
                reward: {
                    type: 'quantity',
                    itemId: 'log_maple',
                    min: 1,
                    max: 3
                }
            }
        ]
    },
    scavenging: {
        id: 'scavenging',
        name: 'Scavenging',
        description: 'Search through wastelands for valuable scrap and components.',
        icon: 'scavenging_icon.png',
        tasks: [
            { 
                id: 'sc_trash', 
                name: 'Sift Trash', 
                level: 1, 
                duration: 3000, 
                xp: 5,
                reward: {
                    type: 'lootTable',
                    table: [
                        { itemId: 'scrap_metal', name: 'Scrap Metal', chance: 0.7, min: 1, max: 3 },
                        { itemId: 'torn_cloth', name: 'Torn Cloth', chance: 0.5, min: 1, max: 2 },
                        { itemId: 'bottle_caps', name: 'Bottle Caps', chance: 0.4, min: 1, max: 5 }
                    ]
                }
            },
            { 
                id: 'sc_ruins', 
                name: 'Explore Ruins', 
                level: 30, 
                duration: 10000, 
                xp: 30,
                reward: {
                    type: 'lootTable',
                    table: [
                        { itemId: 'ancient_scrap', name: 'Ancient Scrap', chance: 0.6, min: 1, max: 2 },
                        { itemId: 'old_gears', name: 'Old Gears', chance: 0.5, min: 1, max: 3 },
                        { itemId: 'mysterious_orb', name: 'Mysterious Orb', chance: 0.15, min: 1, max: 1 }
                    ]
                }
            },
            { 
                id: 'sc_tech', 
                name: 'Salvage Tech', 
                level: 50, 
                duration: 20000, 
                xp: 80,
                reward: {
                    type: 'lootTable',
                    table: [
                        { itemId: 'circuit_board', name: 'Circuit Board', chance: 0.65, min: 1, max: 2 },
                        { itemId: 'power_core', name: 'Power Core', chance: 0.25, min: 1, max: 1 },
                        { itemId: 'broken_chip', name: 'Broken Chip', chance: 0.5, min: 1, max: 4 }
                    ]
                }
            }
        ]
    },
    fishing: {
        id: 'fishing',
        name: 'Fishing',
        description: 'Cast your line to catch fish for food and trade.',
        icon: 'fishing_icon.png',
        tasks: [
            { 
                id: 'fi_shrimp', 
                name: 'Net Shrimp', 
                level: 1, 
                duration: 4000, 
                xp: 8,
                reward: {
                    type: 'quantity',
                    itemId: 'fish_shrimp',
                    min: 1,
                    max: 20
                }
            },
            { 
                id: 'fi_trout', 
                name: 'Lure Trout', 
                level: 20, 
                duration: 9000, 
                xp: 35,
                reward: {
                    type: 'quantity',
                    itemId: 'fish_trout',
                    min: 1,
                    max: 1
                }
            },
            { 
                id: 'fi_shark', 
                name: 'Harpoon Shark', 
                level: 70, 
                duration: 15000, 
                xp: 100,
                reward: {
                    type: 'quantity',
                    itemId: 'fish_shark',
                    min: 1,
                    max: 1
                }
            }
        ]
    }
};
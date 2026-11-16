/*! secret/stages.js — level chunks, stages and items for the hidden side-scrolling breakout */

/**
 * Power-up items. Each one is represented by an icon from the "Licenses and Certifications"
 * section of the page (looked up in icons.svg).
 *
 * @typedef {"multiBall" | "wide" | "guard" | "beam" | "life"} ItemType
 * @type {Record<ItemType, { icon: string, label: string, color: number }>}
 */
export const ITEMS = {
	multiBall: { icon: "bolt", label: "MULTI BALL", color: 0xffd966 },
	wide: { icon: "plus-square", label: "WIDE", color: 0x7dff9b },
	guard: { icon: "shield-alt", label: "GUARD", color: 0x66ccff },
	beam: { icon: "diagnoses", label: "ANTIBODY", color: 0xff8866 },
	life: { icon: "stethoscope", label: "1UP", color: 0xff7799 },
};

/** @type {ItemType[]} */
export const ITEM_TYPES = /** @type {ItemType[]} */ (Object.keys(ITEMS));

/** @type {Record<string, ItemType>} */
export const ICE_BRICK_ITEMS = {
	M: "multiBall",
	W: "wide",
	G: "guard",
	B: "beam",
	L: "life",
};

/** Number of brick rows above the paddle. */
export const ROW_COUNT = 9;

/**
 * Level chunks: ROW_COUNT brick rows (top → bottom).
 * Stages are made by joining chunks side by side, one cell = one world unit.
 *
 * Brick legend:
 *   .  empty
 *   n  allergen (1 hit)
 *   a  armored allergen (2 hits)
 *   s  tissue (unbreakable)
 *   r  red blood cell (unbreakable, bobs up and down)
 *   M W G B L  ice brick holding an item (multiBall / wide / guard / beam / life)
 *   ?  ice brick holding a random item
 *
 * @type {Record<string, string[]>}
 */
export const CHUNKS = {
	start: [
		"..........",
		"..........",
		"..........",
		"..........",
		"..........",
		"..........",
		"..........",
		"..........",
		"..........",
	],
	cluster: [
		"..............",
		"..............",
		"..nnnn........",
		"..nMnn...nnn..",
		"..nnnn...n?n..",
		".........nnn..",
		"..............",
		"..............",
		"..............",
	],
	villi: [
		"..s.....s.....s.",
		"..s.....s.....s.",
		"..n.....s.....n.",
		"........n.......",
		"................",
		"................",
		".....s.....s....",
		".....s.....s....",
		".....s.....s....",
	],
	shortRow: [
		"............",
		"............",
		"............",
		"............",
		"....nnnn....",
		"............",
		"............",
		"............",
		"............",
	],
	softVilli: [
		"...s......s.....",
		"...n......s.....",
		"..........n.....",
		"................",
		"......n?n.......",
		"................",
		"................",
		"................",
		"................",
	],
	allergenRow: [
		"..............",
		"..............",
		"..............",
		"....nnnnnn....",
		"..............",
		"..............",
		"..............",
		"..............",
		"..............",
	],
	wall: [
		"....na....",
		"....an....",
		"....na....",
		"....aW....",
		"....nn....",
		"....na....",
		"....an....",
		"....nn....",
		"....aa....",
	],
	tunnel: [
		"..................",
		"..................",
		"..................",
		"..ssssssssssssss..",
		"..nnnnnBnnnnnnnn..",
		"..................",
		"..................",
		"..................",
		"..................",
	],
	// Rising steps of allergens, hit from below. Each step has only a single tissue cap,
	// so the ball can't get stuck bouncing on top of a wide unbreakable shelf.
	stairs: [
		"................",
		"................",
		".............s..",
		"............nnn.",
		".........s......",
		"........n?n.....",
		".....s..........",
		"....nnn.........",
		"................",
	],
	itemCage: [
		"............",
		"....ssss....",
		"....sLMs....",
		"....saas....",
		"............",
		"............",
		"............",
		"............",
		"............",
	],
	redFlow: [
		"................",
		"................",
		"...r....r....r..",
		"................",
		"......r....r....",
		"................",
		"...nn....n?.....",
		"................",
		"................",
	],
	redCells: [
		"................",
		"................",
		"................",
		".....nnnnnn.....",
		"................",
		"....r...r...r...",
		"................",
		"................",
		"................",
	],
	arena: [
		"........................",
		"........................",
		"........................",
		"........................",
		"........................",
		"........................",
		"........................",
		"........................",
		"........................",
	],
	goal: [
		"........",
		"........",
		"........",
		"........",
		"........",
		"........",
		"........",
		"........",
		"........",
	],
};

/**
 * @typedef {{
 *   name: string,
 *   chunks: (keyof typeof CHUNKS)[],
 *   allergens: string[],
 *   boss?: boolean,
 *   epilogue?: { width: number, lines: string[] },
 *   theme: { background: string, panel: number, tissue: number, cell: number },
 *   tempo: number,
 *   rootNote: number,
 * }} Stage
 * @type {Stage[]}
 */
export const STAGES = [
	{
		name: "STAGE 1 · GUT",
		// A gentle first stage: no pillars, walls or tunnels yet.
		chunks: ["start", "cluster", "shortRow", "softVilli", "stairs", "itemCage", "allergenRow", "cluster", "goal"],
		allergens: ["🥚", "🥛", "🌾", "🥜", "🦐", "🐟"],
		theme: { background: "radial-gradient(ellipse at 50% 30%, rgba(60, 18, 34, .88), rgba(12, 3, 8, .94))", panel: 0x4d1a2c, tissue: 0xd96c84, cell: 0xff9a8a },
		tempo: 112,
		rootNote: 57, // A3
	},
	{
		name: "STAGE 2 · BLOOD",
		chunks: ["start", "redFlow", "villi", "redCells", "cluster", "wall", "redFlow", "redCells", "stairs", "goal"],
		allergens: ["🌲", "🌸", "🐈", "🐕", "🌼", "🦠"],
		theme: { background: "radial-gradient(ellipse at 50% 30%, rgba(70, 8, 16, .88), rgba(14, 2, 4, .94))", panel: 0x5c0f1c, tissue: 0xb8394d, cell: 0xff4d5e },
		tempo: 124,
		rootNote: 60, // C4
	},
	{
		name: "STAGE 3 · SKIN",
		chunks: ["start", "villi", "wall", "redCells", "itemCage", "tunnel", "stairs", "allergenRow", "arena", "goal"],
		allergens: ["🐝", "🦠", "🌸", "🥜", "🐈", "🦐"],
		boss: true,
		// Opens left of the start once the boss is down.
		epilogue: { width: 28, lines: ["Thank you for playing!", "Feel free to talk to me!"] },
		theme: { background: "radial-gradient(ellipse at 50% 30%, rgba(40, 18, 70, .88), rgba(8, 3, 16, .94))", panel: 0x2e1a55, tissue: 0xc184d9, cell: 0xd9a6ff },
		tempo: 136,
		rootNote: 62, // D4
	},
];

/**
 * Joins the chunks of a stage into one layout.
 * Throws if a chunk is malformed, so mistakes show up as soon as the stage is built.
 *
 * @param {Stage} stage
 * @returns {{ rows: string[], width: number }} rows: top → bottom
 */
export const expandStage = (stage) => {
	const rows = Array.from({ length: ROW_COUNT }, () => "");
	for (const name of stage.chunks) {
		const chunk = CHUNKS[name];
		if (chunk === undefined) {
			throw new Error(`${stage.name}: unknown chunk "${name}"`);
		}
		if (chunk.length !== ROW_COUNT) {
			throw new Error(`Chunk "${name}" has ${chunk.length} rows (expected ${ROW_COUNT})`);
		}
		const width = chunk[0].length;
		chunk.forEach((row, index) => {
			if (row.length !== width) {
				throw new Error(`Chunk "${name}" row ${index} is ${row.length} cells wide (expected ${width})`);
			}
		});
		chunk.forEach((row, index) => {
			rows[index] += row;
		});
	}
	return { rows, width: rows[0].length };
};

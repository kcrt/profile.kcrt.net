/*! secret/stages.js — stage layouts and items for the hidden breakout game */

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
	beam: { icon: "diagnoses", label: "BEAM", color: 0xff8866 },
	life: { icon: "stethoscope", label: "1UP", color: 0xff7799 },
};

/** @type {ItemType[]} */
export const ITEM_TYPES = /** @type {ItemType[]} */ (Object.keys(ITEMS));

/**
 * Layout legend:
 *   .  empty
 *   n  normal brick
 *   a  armored brick (2 hits)
 *   s  steel brick (unbreakable, not needed to clear the stage)
 *   M W G B L  ice brick holding an item (multiBall / wide / guard / beam / life)
 *   ?  ice brick holding a random item
 *
 * Stages differ by shape (and moving rows), not by ball speed.
 * movingRows: row index → horizontal oscillation of the whole row.
 *
 * @typedef {{ amplitude: number, speed: number }} RowMotion
 * @typedef {{ name: string, layout: string[], movingRows?: Record<number, RowMotion>, tempo: number, rootNote: number }} Stage
 * @type {Stage[]}
 */
export const STAGES = [
	{
		name: "STAGE 1",
		layout: [
			"aaaaaaaa",
			"nnnnnnnn",
			"nnMnnWnn",
			"nnnnnnnn",
			"nGnnnnBn",
			"nnnnnnnn",
		],
		tempo: 112,
		rootNote: 57, // A3
	},
	{
		name: "STAGE 2",
		layout: [
			"s..aa..s",
			"..aMWa..",
			".annnna.",
			"anGn?Lna",
			".annnna.",
			"..anBa..",
			"...aa...",
		],
		tempo: 124,
		rootNote: 60, // C4
	},
	{
		name: "STAGE 3",
		layout: [
			"aaaaaaaa",
			".nnMWnn.",
			"s.n??n.s",
			"nnGssBnn",
			".nnnnnn.",
			"LnaaaanM",
			"nnnnnnnn",
		],
		movingRows: {
			1: { amplitude: 0.9, speed: 1.3 },
			4: { amplitude: 0.9, speed: -1.1 },
		},
		tempo: 136,
		rootNote: 62, // D4
	},
];

/** @type {Record<string, ItemType>} */
export const ICE_BRICK_ITEMS = {
	M: "multiBall",
	W: "wide",
	G: "guard",
	B: "beam",
	L: "life",
};

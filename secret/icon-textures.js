/*! secret/icon-textures.js — turns symbols from icons.svg into glowing textures */
import * as THREE from "three/webgpu";

const ICON_SPRITE_URL = new URL("../icons.svg", import.meta.url).href;
const TEXTURE_SIZE = 256;
const ICON_PADDING = 0.18;

const loadImage = (url) =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.addEventListener("load", () => resolve(image), { once: true });
		image.addEventListener("error", () => reject(new Error(`Failed to load ${url}`)), { once: true });
		image.src = url;
	});

/**
 * Loads the given icons from icons.svg and returns a CanvasTexture per icon name.
 * Each texture is a white icon with a soft glow on a transparent background, so it can be tinted.
 *
 * @param {string[]} iconNames
 * @returns {Promise<Map<string, THREE.CanvasTexture>>}
 */
export const loadIconTextures = async (iconNames) => {
	const response = await fetch(ICON_SPRITE_URL);
	const sprite = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
	const textures = new Map();

	for (const name of iconNames) {
		const symbol = sprite.getElementById(name);
		if (symbol === null) {
			throw new Error(`Icon "${name}" not found in icons.svg`);
		}
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${symbol.getAttribute("viewBox")}" width="${TEXTURE_SIZE}" height="${TEXTURE_SIZE}"><g fill="#ffffff">${symbol.innerHTML}</g></svg>`;
		const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
		try {
			const image = await loadImage(url);
			const canvas = document.createElement("canvas");
			canvas.width = TEXTURE_SIZE;
			canvas.height = TEXTURE_SIZE;
			const context = canvas.getContext("2d");
			const padding = TEXTURE_SIZE * ICON_PADDING;
			const drawSize = TEXTURE_SIZE - padding * 2;
			context.shadowColor = "rgba(255, 255, 255, .9)";
			context.shadowBlur = TEXTURE_SIZE * 0.06;
			context.drawImage(image, padding, padding, drawSize, drawSize);
			const texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			textures.set(name, texture);
		} finally {
			URL.revokeObjectURL(url);
		}
	}
	return textures;
};

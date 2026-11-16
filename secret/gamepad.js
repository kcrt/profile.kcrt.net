/*! secret/gamepad.js — reads game controllers through the Gamepad API */

const STICK_DEADZONE = 0.2;

/**
 * Button indices of the standard gamepad mapping (https://w3c.github.io/gamepad/#remapping).
 * Face buttons are named by position, since their labels differ between controllers
 * (bottom = A on Xbox, Cross on PlayStation, B on Nintendo).
 */
export const GAMEPAD_BUTTONS = {
	faceBottom: 0,
	faceRight: 1,
	start: 9,
	up: 12,
	down: 13,
	left: 14,
	right: 15,
};

/** @typedef {keyof typeof GAMEPAD_BUTTONS} GamepadButton */

/** Rescales a stick axis so the deadzone maps to 0 and full tilt to ±1. */
const applyDeadzone = (value) => (Math.abs(value) <= STICK_DEADZONE ? 0 : (Math.sign(value) * (Math.abs(value) - STICK_DEADZONE)) / (1 - STICK_DEADZONE));

/** Polls every connected controller and merges them, so any of them can be used. */
export class GamepadInput {
	constructor() {
		/** @type {Set<GamepadButton>} */
		this.previouslyPressed = new Set();
	}

	/**
	 * Call once per frame.
	 * @returns {{ isConnected: boolean, move: number, justPressed: Set<GamepadButton> }}
	 *   move: horizontal input from -1 (left) to 1 (right), from the left stick or the D-pad
	 */
	poll() {
		const pads = (navigator.getGamepads?.() ?? []).filter((pad) => pad !== null && pad.connected);
		/** @type {Set<GamepadButton>} */
		const pressed = new Set();
		let move = 0;
		for (const pad of pads) {
			for (const [name, index] of Object.entries(GAMEPAD_BUTTONS)) {
				if (pad.buttons[index]?.pressed) {
					pressed.add(/** @type {GamepadButton} */ (name));
				}
			}
			const stick = applyDeadzone(pad.axes[0] ?? 0);
			if (Math.abs(stick) > Math.abs(move)) {
				move = stick;
			}
		}
		if (pressed.has("left") !== pressed.has("right")) {
			move = pressed.has("left") ? -1 : 1;
		}
		const justPressed = new Set([...pressed].filter((name) => !this.previouslyPressed.has(name)));
		this.previouslyPressed = pressed;
		return { isConnected: pads.length > 0, move, justPressed };
	}
}

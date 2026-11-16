/*! secret/breakout.js — a glassy side-scrolling 3D breakout hidden in profile.kcrt.net */
import * as THREE from "three/webgpu";
import { clamp, luminance, max, pass, renderOutput, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ICE_BRICK_ITEMS, ITEMS, ITEM_TYPES, ROW_COUNT, STAGES, expandStage } from "./stages.js";
import { SoundEngine } from "./sound.js";
import { loadIconTextures } from "./icon-textures.js";
import { GamepadInput } from "./gamepad.js";

// The player is a white blood cell (the profile photo in a glass bubble) travelling through
// the body. The ball falls under gravity and is kept alive with the paddle; the camera follows
// the ball to the right until it reaches the lymph node gate at the end of the stage.

// ---------- Tunables ----------
// World: x grows to the right (0 = start of the stage, 1 unit = 1 level cell), y = 0 is the paddle.
const BRICK_BOTTOM_Y = 1.5; // center of the lowest brick row
const CEILING_Y = BRICK_BOTTOM_Y + ROW_COUNT - 0.2;
const VIEW_BOTTOM_Y = -1.6;
const VIEW_TOP_Y = CEILING_Y + 0.6;
const VIEW_CENTER_Y = (VIEW_BOTTOM_Y + VIEW_TOP_Y) / 2;
const MIN_HALF_VIEW_WIDTH = 7;

const GRAVITY = 11; // low gravity: the ball floats, so there's time to get under it
const BALL_RADIUS = 0.4;
const BALL_LAUNCH_SPEED = 14; // a straight-up bounce almost reaches the ceiling
const BALL_MAX_SPEED = 19;
const MAX_BOUNCE_ANGLE = THREE.MathUtils.degToRad(55);
const PADDLE_VELOCITY_TRANSFER = 0.2;
const GHOST_AFTER_SECONDS = 8; // a ball stuck among the bricks passes through them after this
const BALL_LOST_Y = VIEW_BOTTOM_Y - 1;
const MAX_BALLS = 6;

const PADDLE_WIDTH = 3.2;
const PADDLE_CATCH_MARGIN = 0.3; // a ball just past the paddle end still counts as a hit
const PADDLE_HEIGHT = 0.36;
const PADDLE_Y = 0;
const PADDLE_START_X = 5;
const PADDLE_KEYBOARD_SPEED = 16;

const BRICK_ROW_HUES = [0.92, 0.02, 0.1, 0.17, 0.33, 0.5, 0.62, 0.75, 0.85];
const BRICK_SIZE = 0.9;
const BRICK_DEPTH = 0.7;
const BRICK_COLLISION_REACH = BRICK_SIZE / 2 + BALL_RADIUS + 0.2;
const RED_CELL_BOB_AMPLITUDE = 1.1;
const RED_CELL_BOB_SPEED = 1.6;

const ITEM_RADIUS = 0.42;
const ITEM_FALL_SPEED = 3.2;
const RANDOM_DROP_CHANCE = 0.1;
const WIDE_DURATION = 12;
const WIDE_FACTOR = 1.6;
const ITCH_DURATION = 4;
const ITCH_FACTOR = 0.45; // clearly shorter at a glance
const GUARD_DURATION = 20;
const LAUNCH_GUARD_DURATION = 5; // every launch starts with a short guard
const GUARD_Y = PADDLE_Y - 0.9;
const BEAM_DURATION = 10;
const BEAM_COOLDOWN = 0.22;
const BEAM_SPEED = 14;
// Antibody-shaped (Y) beam: stem + two arms with glowing antigen-binding tips.
const ANTIBODY_STEM_LENGTH = 0.45;
const ANTIBODY_ARM_LENGTH = 0.38;
const ANTIBODY_ARM_ANGLE = 0.6;
const ANTIBODY_TIP_RADIUS = 0.07;
const ANTIBODY_SPIN_SPEED = 9;
const ANTIBODY_ARM_TIP = new THREE.Vector2(
	Math.sin(ANTIBODY_ARM_ANGLE) * ANTIBODY_ARM_LENGTH,
	Math.cos(ANTIBODY_ARM_ANGLE) * ANTIBODY_ARM_LENGTH,
);
const ANTIBODY_HALF_WIDTH = ANTIBODY_ARM_TIP.x + ANTIBODY_TIP_RADIUS;
const ANTIBODY_TOP = ANTIBODY_ARM_TIP.y + ANTIBODY_TIP_RADIUS;
// Entering the Konami code while paused turns on MAX POWER (every power-up, for the rest of the run).
const KONAMI_CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
// B and A sit in swapped positions on Nintendo-style controllers, so either order is accepted.
const KONAMI_CODES = [KONAMI_CODE, [...KONAMI_CODE.slice(0, -2), "a", "b"]];
// Gamepad buttons used in the Konami code, named like the keys (face buttons by their Xbox labels).
const GAMEPAD_CHEAT_KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", faceRight: "b", faceBottom: "a" };
const MAX_POWER_EFFECT_TIME = 99;
const INITIAL_LIVES = 5;
const MAX_LIVES = 7;

const GOAL_DISTANCE_FROM_END = 3;
const DEADLINE_DASH_SPACING = 1;
const EPILOGUE_TEXT_WIDTH = 22;
// The message is right-aligned so its "!" ends just left of the start wall: with the camera at
// the start, the edge of the screen shows a sliver of it as a hint for sharp-eyed players.
const EPILOGUE_TEXT_RIGHT_X = -1.3;
const START_WALL_FADE_SPEED = 1.5;
// Keys 1–3 jump to a stage, but only while developing locally.
const IS_LOCAL_DEVELOPMENT = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const GOAL_RING_RADIUS = 2.6;

// Mast cell boss guarding the gate of the last stage.
const BOSS_DISTANCE_FROM_GOAL = 10;
const BOSS_RADIUS = 1.7;
const BOSS_HIT_POINTS = 10;
const BOSS_HIT_COOLDOWN = 0.2;
const BOSS_BASE_Y = 5.6;
const BOSS_BOB_AMPLITUDE = 2.2;
const BOSS_BOB_SPEED = 0.8;
const BOSS_GRANULE_COUNT = 28;
const HISTAMINE_INTERVAL = 2.6;
const HISTAMINE_RADIUS = 0.22;
const HISTAMINE_GRAVITY = 9;

const BASE_BALL_COLOR = new THREE.Color(0x88ccff);
const LOST_BALL_COLOR = new THREE.Color(0xff5577);
const TRAIL_LENGTH = 18;
const SHARD_POOL_SIZE = 700;
const SHARDS_PER_BRICK = 16;
const DUST_COUNT = 140;
const DUST_HALF_RANGE_X = 20;
const BACKGROUND_CELLS_PER_UNIT = 0.35;

const CAMERA_FOV = 42;
const CAMERA_LEAD = 2.5; // the camera looks ahead in the direction the ball travels
const CAMERA_FOLLOW_RATE = 3;
const INTRO_DURATION = 1.1;
const BRICK_POP_DURATION = 0.18;
const TOAST_DURATION_MS = 1400;

const STYLESHEET_URL = new URL("./breakout.css", import.meta.url).href;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

// ---------- Helpers ----------
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);
const randomBetween = (min, max) => min + Math.random() * (max - min);
const randomItem = () => ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
const randomElement = (array) => array[Math.floor(Math.random() * array.length)];
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** Formats a duration in milliseconds as nanoseconds, e.g. "42,123,456,789 ns". */
const formatNanoseconds = (milliseconds) => `${BigInt(Math.round(milliseconds * 1e6)).toLocaleString("en-US")} ns`;

const loadStylesheet = (href) =>
	new Promise((resolve, reject) => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		link.addEventListener("load", () => resolve(link), { once: true });
		link.addEventListener("error", () => reject(new Error(`Failed to load ${href}`)), { once: true });
		document.head.append(link);
	});

const createCanvasTexture = (size, draw) => {
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	draw(canvas.getContext("2d"), size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
};

/** Draws the profile photo into a circular texture used inside the glass ball. */
const createPhotoTexture = (image) =>
	createCanvasTexture(256, (context, size) => {
		context.beginPath();
		context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
		context.clip();
		context.drawImage(image, 0, 0, size, size);
	});

/** Soft radial glow used around balls, items and background cells. */
const createGlowTexture = () =>
	createCanvasTexture(128, (context, size) => {
		const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		gradient.addColorStop(0, "rgba(255,255,255,1)");
		gradient.addColorStop(0.35, "rgba(255,255,255,.35)");
		gradient.addColorStop(1, "rgba(255,255,255,0)");
		context.fillStyle = gradient;
		context.fillRect(0, 0, size, size);
	});

/** An allergen emoji shown on the front of a brick. */
const createEmojiTexture = (emoji) =>
	createCanvasTexture(128, (context, size) => {
		context.font = `${Math.round(size * 0.78)}px ${EMOJI_FONT}`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(emoji, size / 2, size * 0.54);
	});

/** The thank-you message written on the back wall of the hidden area left of the start (right-aligned). */
const createEpilogueTexture = (lines) => {
	const width = 2048;
	const height = 640;
	const rightPadding = 16; // room for the glow
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	context.font = `700 ${Math.round(height * 0.22)}px system-ui, sans-serif`;
	context.textAlign = "right";
	context.textBaseline = "middle";
	context.fillStyle = "#ffffff";
	context.shadowColor = "rgba(255, 255, 255, .9)";
	context.shadowBlur = height * 0.015;
	lines.forEach((line, index) => {
		context.fillText(line, width - rightPadding, (height * (index + 1)) / (lines.length + 1));
	});
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return { texture, aspect: width / height, rightPaddingRatio: rightPadding / width };
};

/** Disposes the geometries and materials of a level object tree (shared textures are kept). */
const disposeObjectTree = (root) => {
	root.traverse((object) => {
		if (!object.isSprite) {
			object.geometry?.dispose();
		}
		for (const material of [object.material].flat()) {
			material?.dispose();
		}
	});
};

// ---------- Game ----------
class BreakoutGame {
	/**
	 * @param {HTMLImageElement} photo
	 * @param {() => void} onStart - called when the game becomes visible
	 * @param {(fraction: number) => void} onProgress - startup progress (0–1)
	 */
	constructor(photo, onStart, onProgress) {
		this.photo = photo;
		this.onStart = onStart;
		this.onProgress = onProgress;

		this.state = "loading"; // loading | intro | ready | playing | stageClear | over | complete | closed
		this.stageIndex = 0;
		this.score = 0;
		this.lives = INITIAL_LIVES;
		this.combo = 0;
		this.stateTime = 0;
		this.stageTime = 0;
		this.stageStartedAt = 0;
		this.totalClearTime = 0;

		this.levelWidth = 0;
		this.goalX = 0;
		this.levelGroup = null;
		this.leftBoundX = 0; // moves left when the hidden area behind the start opens
		this.epilogueTexture = null;

		this.paddleX = PADDLE_START_X;
		this.paddleTargetX = PADDLE_START_X;
		this.paddleVelocity = 0;
		this.paddleWidth = PADDLE_WIDTH;
		this.pointerClient = null;
		this.keysHeld = new Set();

		this.isPaused = false;
		this.pausedAt = 0;
		this.messageBeforePause = "";
		this.recentPausedKeys = [];
		this.isMaxPower = false;

		this.gamepad = new GamepadInput();
		this.gamepadMove = 0;
		this.isGamepadConnected = false;

		this.balls = [];
		this.ballIntroFrom = new THREE.Vector3();

		this.wideTime = 0;
		this.itchTime = 0;
		this.guardTime = 0;
		this.beamTime = 0;
		this.beamCooldown = 0;
		this.beams = [];
		this.items = [];

		this.boss = null;
		this.histamines = [];

		this.cameraX = 0;
		this.cameraShake = 0;
		this.cameraDistance = 30;
		this.halfViewWidth = MIN_HALF_VIEW_WIDTH;

		this.bricks = [];
		this.shards = [];
		this.dust = [];
		this.emojiTextures = new Map();

		this.raycaster = new THREE.Raycaster();
		this.pointer = new THREE.Vector2();
		this.fieldPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
		this.dummy = new THREE.Object3D();
		this.lastFrameTime = performance.now();

		// Created right away so it is still inside the user gesture that triggered the game.
		this.sound = new SoundEngine();

		this.closed = new Promise((resolve) => {
			this.resolveClosed = resolve;
		});
	}

	get stage() {
		return STAGES[this.stageIndex];
	}

	get leadBall() {
		return this.balls[0];
	}

	get isGoalLocked() {
		return this.boss !== null && this.boss.hitPoints > 0;
	}

	async start() {
		const photoRect = this.photo.getBoundingClientRect();
		this.stylesheet = await loadStylesheet(STYLESHEET_URL);
		this.createOverlay();
		this.onProgress(0.1);

		try {
			await this.createRenderer();
		} catch (error) {
			console.error(error);
			this.showOverlay();
			this.setMessage("This browser can't run the hidden game 😢");
			setTimeout(() => this.close(), 2500);
			return this.closed;
		}
		this.onProgress(0.25);

		this.iconTextures = await loadIconTextures(Object.values(ITEMS).map((item) => item.icon));
		this.onProgress(0.35);
		await nextFrame();

		this.createScene();
		this.buildStage();
		this.fitCamera();
		this.onProgress(0.5);
		await nextFrame();

		// Compile shaders and warm up the post-processing while the overlay is still invisible,
		// so the page keeps animating instead of freezing on the first frame.
		// The boss is shown meanwhile so its shaders are ready when the last stage starts.
		const isBossVisible = this.bossGroup.visible;
		this.bossGroup.visible = true;
		await this.renderer.compileAsync(this.scene, this.camera);
		this.bossGroup.visible = isBossVisible;
		this.onProgress(0.85);
		await nextFrame();
		this.pipeline.render();
		this.onProgress(1);
		await nextFrame();

		this.ballIntroFrom.copy(this.screenToField(photoRect.left + photoRect.width / 2, photoRect.top + photoRect.height / 2));
		this.photo.style.visibility = "hidden";
		this.showOverlay();
		this.bindEvents();
		this.startStage();
		this.lastFrameTime = performance.now();
		this.renderer.setAnimationLoop(() => this.tick());
		return this.closed;
	}

	showOverlay() {
		this.lockPage();
		this.onStart();
		this.overlay.classList.add("is-visible");
	}

	// ----- Setup -----
	createOverlay() {
		this.overlay = document.createElement("div");
		this.overlay.className = "secret-overlay";

		this.hud = document.createElement("div");
		this.hud.className = "secret-hud";
		this.scoreLabel = document.createElement("span");
		this.livesLabel = document.createElement("span");
		this.stageLabel = document.createElement("span");
		this.progressLabel = document.createElement("span");
		this.comboLabel = document.createElement("span");
		this.comboLabel.className = "secret-combo";
		this.effectsLabel = document.createElement("span");
		this.effectsLabel.className = "secret-effects";
		this.bossLabel = document.createElement("span");
		this.bossLabel.className = "secret-boss";
		this.hud.append(this.scoreLabel, this.livesLabel, this.stageLabel, this.progressLabel, this.comboLabel, this.effectsLabel, this.bossLabel);

		this.closeButton = document.createElement("button");
		this.closeButton.type = "button";
		this.closeButton.className = "secret-button secret-close";
		this.closeButton.setAttribute("aria-label", "Close");
		this.closeButton.textContent = "✕";

		this.muteButton = document.createElement("button");
		this.muteButton.type = "button";
		this.muteButton.className = "secret-button secret-mute";
		this.updateMuteButton();

		this.pauseButton = document.createElement("button");
		this.pauseButton.type = "button";
		this.pauseButton.className = "secret-button secret-pause";
		this.updatePauseButton();

		this.messageBox = document.createElement("div");
		this.messageBox.className = "secret-message";

		this.toast = document.createElement("div");
		this.toast.className = "secret-toast";

		this.overlay.append(this.hud, this.pauseButton, this.muteButton, this.closeButton, this.messageBox, this.toast);
		document.body.append(this.overlay);
		this.updateHud();
	}

	lockPage() {
		this.previousOverflow = document.documentElement.style.overflow;
		document.documentElement.style.overflow = "hidden";
	}

	async createRenderer() {
		this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		await this.renderer.init();
		this.overlay.prepend(this.renderer.domElement);
	}

	createScene() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 200);

		this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
		this.environmentTarget = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
		this.scene.environment = this.environmentTarget.texture;
		this.scene.environmentIntensity = 0.3;

		this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
		this.keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
		this.keyLight.position.set(4, 6, 10);
		this.scene.add(this.keyLight, this.keyLight.target);
		this.ballLight = new THREE.PointLight(BASE_BALL_COLOR, 25, 14, 2);
		this.ballLight.position.z = 2.5;
		this.scene.add(this.ballLight);

		this.photoTexture = createPhotoTexture(this.photo);
		this.glowTexture = createGlowTexture();
		this.ballShellGeometry = new THREE.SphereGeometry(BALL_RADIUS, 48, 32);
		this.trailGeometry = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
		this.itemShellGeometry = new THREE.SphereGeometry(ITEM_RADIUS, 32, 24);

		this.brickGeometry = new THREE.BoxGeometry(BRICK_SIZE, BRICK_SIZE, BRICK_DEPTH);
		this.brickEdgesGeometry = new THREE.EdgesGeometry(this.brickGeometry);
		this.brickIconGeometry = new THREE.PlaneGeometry(BRICK_SIZE * 0.82, BRICK_SIZE * 0.82);
		this.redCellGeometry = new THREE.TorusGeometry(BRICK_SIZE * 0.32, BRICK_SIZE * 0.16, 12, 24);

		this.createPaddle();
		this.createGuard();
		this.createBeams();
		this.createBoss();
		this.createShards();
		this.createDust();
		this.createPipeline();
	}

	/** (Re)creates everything that belongs to the current stage: bricks, deadline, gate and backdrop. */
	buildStage() {
		for (const brick of this.bricks) {
			this.scene.remove(brick.mesh);
			brick.mesh.material.dispose();
			brick.edges?.material.dispose();
			brick.icon?.material.dispose();
		}
		this.bricks = [];
		if (this.levelGroup) {
			this.scene.remove(this.levelGroup);
			disposeObjectTree(this.levelGroup);
		}
		this.levelGroup = new THREE.Group();
		this.scene.add(this.levelGroup);

		const { rows, width } = expandStage(this.stage);
		this.levelWidth = width;
		this.leftBoundX = 0;
		this.epilogueTexture?.dispose();
		this.epilogueTexture = null;
		this.goalX = width - GOAL_DISTANCE_FROM_END;
		this.overlay.style.background = this.stage.theme.background;

		rows.forEach((rowLayout, row) => {
			const hue = BRICK_ROW_HUES[row % BRICK_ROW_HUES.length];
			const y = BRICK_BOTTOM_Y + (ROW_COUNT - 1 - row);
			[...rowLayout].forEach((cell, column) => {
				if (cell === ".") {
					return;
				}
				const item = cell === "?" ? randomItem() : ICE_BRICK_ITEMS[cell];
				const kind = item ? "ice" : { a: "armored", s: "tissue", r: "redCell" }[cell] ?? "allergen";
				this.bricks.push(this.createBrick({ kind, item, hue, x: column + 0.5, y, row, column }));
			});
		});

		this.createBackdrop();
		this.createDeadline();
		this.createGate();
		this.resetBoss();
	}

	createBackdrop() {
		const { theme } = this.stage;
		const margin = 30;
		// The hidden area (if any) lies left of x = 0, behind the start wall.
		const startX = -(this.stage.epilogue?.width ?? 0);
		const spanWidth = this.levelWidth - startX;
		const spanCenterX = (startX + this.levelWidth) / 2;
		const height = VIEW_TOP_Y - VIEW_BOTTOM_Y + 8;
		const backPanel = new THREE.Mesh(
			new THREE.PlaneGeometry(spanWidth + margin * 2, height),
			new THREE.MeshBasicMaterial({ color: theme.panel, transparent: true, opacity: 0.35, depthWrite: false }),
		);
		backPanel.position.set(spanCenterX, VIEW_CENTER_Y, -0.9);

		// A grid of 2-unit squares behind the field; it makes the scrolling easy to feel.
		const gridPoints = [];
		const bottom = VIEW_BOTTOM_Y - 2;
		const top = VIEW_TOP_Y + 2;
		for (let x = startX - margin; x <= this.levelWidth + margin; x += 2) {
			gridPoints.push(x, bottom, 0, x, top, 0);
		}
		for (let y = Math.ceil(bottom / 2) * 2; y <= top; y += 2) {
			gridPoints.push(startX - margin, y, 0, this.levelWidth + margin, y, 0);
		}
		const gridGeometry = new THREE.BufferGeometry();
		gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(gridPoints, 3));
		const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: theme.cell, transparent: true, opacity: 0.14, depthWrite: false }));
		grid.position.z = -0.88;

		// Big blurry cells floating far behind the field.
		const cellMaterial = new THREE.SpriteMaterial({
			map: this.glowTexture,
			color: new THREE.Color(theme.cell),
			transparent: true,
			opacity: 0.16,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const cellCount = Math.round(spanWidth * BACKGROUND_CELLS_PER_UNIT);
		for (let index = 0; index < cellCount; index++) {
			const cell = new THREE.Sprite(cellMaterial);
			cell.position.set(randomBetween(startX - margin / 2, this.levelWidth + margin / 2), randomBetween(VIEW_BOTTOM_Y - 4, VIEW_TOP_Y + 4), randomBetween(-12, -4));
			cell.scale.setScalar(randomBetween(2, 7));
			this.levelGroup.add(cell);
		}

		// Glowing walls at both ends of the stage and along the ceiling.
		this.wallMaterial = new THREE.MeshStandardMaterial({ color: 0x111122, emissive: theme.cell, emissiveIntensity: 1.6, transparent: true, opacity: 0.9 });
		const sideGeometry = new THREE.BoxGeometry(0.12, CEILING_Y - PADDLE_Y + 1.2, 0.12);
		const wallCenterY = (CEILING_Y + PADDLE_Y - 1.2) / 2;
		// The start wall has its own material, as it fades away when the hidden area opens.
		this.startWallMaterial = this.wallMaterial.clone();
		this.startWall = new THREE.Mesh(sideGeometry, this.startWallMaterial);
		this.startWall.position.set(-0.06, wallCenterY, 0);
		const rightWall = new THREE.Mesh(sideGeometry.clone(), this.wallMaterial);
		rightWall.position.set(this.levelWidth + 0.06, wallCenterY, 0);
		const ceiling = new THREE.Mesh(new THREE.BoxGeometry(spanWidth + 0.24, 0.12, 0.12), this.wallMaterial);
		ceiling.position.set(spanCenterX, CEILING_Y + 0.06, 0);
		this.levelGroup.add(backPanel, grid, this.startWall, rightWall, ceiling);

		if (this.stage.epilogue) {
			const outerWall = new THREE.Mesh(sideGeometry.clone(), this.wallMaterial);
			outerWall.position.set(startX - 0.06, wallCenterY, 0);
			const { texture, aspect, rightPaddingRatio } = createEpilogueTexture(this.stage.epilogue.lines);
			this.epilogueTexture = texture;
			const message = new THREE.Mesh(
				new THREE.PlaneGeometry(EPILOGUE_TEXT_WIDTH, EPILOGUE_TEXT_WIDTH / aspect),
				new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(theme.cell).lerp(new THREE.Color(0xffffff), 0.5).multiplyScalar(0.7), transparent: true, depthWrite: false }),
			);
			message.position.set(EPILOGUE_TEXT_RIGHT_X + (rightPaddingRatio - 0.5) * EPILOGUE_TEXT_WIDTH, VIEW_CENTER_Y + 0.6, -0.8);
			this.levelGroup.add(outerWall, message);
		}
	}

	/** Opens the hidden area left of the start (after the boss of a stage with an epilogue is down). */
	openEpilogue() {
		if (!this.stage.epilogue) {
			return;
		}
		this.leftBoundX = -this.stage.epilogue.width;
	}

	/**
	 * A dim red dashed line under the paddle: below it the ball is lost. It is kept dark and
	 * dashed so it can't be mistaken for the (bright, solid) guard.
	 */
	createDeadline() {
		const startX = -(this.stage.epilogue?.width ?? 0);
		const dashCount = Math.ceil((this.levelWidth - startX) / DEADLINE_DASH_SPACING);
		const deadline = new THREE.InstancedMesh(
			new THREE.BoxGeometry(DEADLINE_DASH_SPACING * 0.5, 0.05, 0.05),
			new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4466).multiplyScalar(0.55), transparent: true, opacity: 0.6, depthWrite: false }),
			dashCount,
		);
		// The shared dummy may still hold the rotation / scale of the last shard.
		this.dummy.rotation.set(0, 0, 0);
		this.dummy.scale.setScalar(1);
		for (let index = 0; index < dashCount; index++) {
			this.dummy.position.set(startX + (index + 0.5) * DEADLINE_DASH_SPACING, PADDLE_Y - PADDLE_HEIGHT / 2 - 0.25, 0);
			this.dummy.updateMatrix();
			deadline.setMatrixAt(index, this.dummy.matrix);
		}
		this.levelGroup.add(deadline);
	}

	/** The lymph node gate at the end of the stage, with a barrier while the boss is alive. */
	createGate() {
		const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x7dff9b, emissiveIntensity: 2.2 });
		this.gateRing = new THREE.Mesh(new THREE.TorusGeometry(GOAL_RING_RADIUS, 0.14, 16, 64), ringMaterial);
		this.gateRing.position.set(this.goalX, VIEW_CENTER_Y, 0);
		this.gateRing.rotation.y = 1.1;

		this.gateBeamMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dff9b).multiplyScalar(1.5), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
		const gateBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.5, CEILING_Y - PADDLE_Y + 1), this.gateBeamMaterial);
		gateBeam.position.set(this.goalX, (CEILING_Y + PADDLE_Y) / 2, -0.2);

		this.barrierMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd96cff).multiplyScalar(1.4), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
		this.barrier = new THREE.Mesh(new THREE.BoxGeometry(0.2, CEILING_Y - PADDLE_Y + 1, 0.6), this.barrierMaterial);
		this.barrier.position.set(this.goalX, (CEILING_Y + PADDLE_Y) / 2, 0);

		this.levelGroup.add(this.gateRing, gateBeam, this.barrier);
	}

	createPaddle() {
		const geometry = new THREE.CapsuleGeometry(PADDLE_HEIGHT / 2, PADDLE_WIDTH - PADDLE_HEIGHT, 8, 24);
		geometry.rotateZ(Math.PI / 2);
		this.paddleMaterial = new THREE.MeshPhysicalMaterial({
			color: 0xbfe8ff,
			emissive: 0x44bbff,
			emissiveIntensity: 0.8,
			transparent: true,
			opacity: 0.75,
			roughness: 0.05,
			metalness: 0.1,
			clearcoat: 1,
			iridescence: 1,
			iridescenceIOR: 1.5,
		});
		this.paddle = new THREE.Mesh(geometry, this.paddleMaterial);
		this.paddle.position.set(this.paddleX, PADDLE_Y, 0);
		this.scene.add(this.paddle);

		// Beam emitters at both ends of the paddle, shown while the beam item is active.
		const emitterMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(ITEMS.beam.color).multiplyScalar(2) });
		const emitterGeometry = new THREE.ConeGeometry(0.14, 0.4, 12);
		this.beamEmitters = [-1, 1].map((side) => {
			const emitter = new THREE.Mesh(emitterGeometry, emitterMaterial);
			emitter.userData.side = side;
			emitter.visible = false;
			this.scene.add(emitter);
			return emitter;
		});
	}

	createGuard() {
		this.guardMaterial = new THREE.MeshStandardMaterial({
			color: 0x112233,
			emissive: ITEMS.guard.color,
			emissiveIntensity: 2,
			transparent: true,
			opacity: 0.85,
		});
		// Unit width: scaled to the visible width every frame, as it follows the camera.
		this.guard = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 0.3), this.guardMaterial);
		this.guard.position.set(0, GUARD_Y, 0);
		this.guard.visible = false;
		this.scene.add(this.guard);
	}

	createBeams() {
		const color = new THREE.Color(ITEMS.beam.color);
		this.antibodyStemGeometry = new THREE.CapsuleGeometry(0.05, ANTIBODY_STEM_LENGTH, 4, 8);
		// Arms pivot at the fork (their bottom end), so translate them up by half their length.
		this.antibodyArmGeometry = new THREE.CapsuleGeometry(0.045, ANTIBODY_ARM_LENGTH, 4, 8).translate(0, ANTIBODY_ARM_LENGTH / 2, 0);
		this.antibodyTipGeometry = new THREE.SphereGeometry(ANTIBODY_TIP_RADIUS, 12, 8);
		this.beamMaterial = new THREE.MeshBasicMaterial({
			color: color.clone().multiplyScalar(3),
			transparent: true,
			opacity: 0.95,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		this.antibodyTipMaterial = new THREE.MeshBasicMaterial({
			color: new THREE.Color(0xffffff).lerp(color, 0.3).multiplyScalar(4),
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
	}

	/** Builds a Y-shaped antibody whose origin is the fork point. */
	createAntibody() {
		const antibody = new THREE.Group();
		const stem = new THREE.Mesh(this.antibodyStemGeometry, this.beamMaterial);
		stem.position.y = -ANTIBODY_STEM_LENGTH / 2;
		antibody.add(stem);
		for (const side of [-1, 1]) {
			const arm = new THREE.Mesh(this.antibodyArmGeometry, this.beamMaterial);
			arm.rotation.z = -side * ANTIBODY_ARM_ANGLE;
			const tip = new THREE.Mesh(this.antibodyTipGeometry, this.antibodyTipMaterial);
			tip.position.set(side * ANTIBODY_ARM_TIP.x, ANTIBODY_ARM_TIP.y, 0);
			antibody.add(arm, tip);
		}
		return antibody;
	}

	/** The mast cell: a glassy cell packed with histamine granules around a nucleus. */
	createBoss() {
		this.bossGroup = new THREE.Group();
		this.bossShellMaterial = new THREE.MeshPhysicalMaterial({
			color: 0xd9a6ff,
			emissive: 0x8a3dd9,
			emissiveIntensity: 0.4,
			transparent: true,
			opacity: 0.35,
			roughness: 0.1,
			clearcoat: 1,
			iridescence: 1,
			iridescenceIOR: 1.4,
			depthWrite: false,
		});
		const shell = new THREE.Mesh(new THREE.SphereGeometry(BOSS_RADIUS, 48, 32), this.bossShellMaterial);
		shell.renderOrder = 2;
		const nucleus = new THREE.Mesh(
			new THREE.SphereGeometry(BOSS_RADIUS * 0.38, 32, 24),
			new THREE.MeshStandardMaterial({ color: 0x3a1066, emissive: 0x9b4dff, emissiveIntensity: 0.8 }),
		);
		this.histamineGeometry = new THREE.SphereGeometry(HISTAMINE_RADIUS, 16, 12);
		this.histamineMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff66dd).multiplyScalar(2.2) });
		this.bossGranules = new THREE.Group();
		for (let index = 0; index < BOSS_GRANULE_COUNT; index++) {
			const granule = new THREE.Mesh(this.histamineGeometry, this.histamineMaterial);
			granule.position.randomDirection().multiplyScalar(randomBetween(BOSS_RADIUS * 0.45, BOSS_RADIUS * 0.8));
			granule.scale.setScalar(randomBetween(0.6, 1.1));
			this.bossGranules.add(granule);
		}
		this.bossGroup.add(nucleus, this.bossGranules, shell);
		this.bossGroup.visible = false;
		this.scene.add(this.bossGroup);
	}

	resetBoss() {
		this.clearHistamines();
		if (!this.stage.boss) {
			this.boss = null;
			this.bossGroup.visible = false;
			return;
		}
		this.boss = {
			position: new THREE.Vector3(this.goalX - BOSS_DISTANCE_FROM_GOAL, BOSS_BASE_Y, 0),
			hitPoints: BOSS_HIT_POINTS,
			hitCooldown: 0,
			releaseTimer: HISTAMINE_INTERVAL,
			flash: 0,
			deathTime: 0,
		};
		this.bossGroup.visible = true;
		this.bossGroup.scale.setScalar(1);
		this.bossGroup.position.copy(this.boss.position);
	}

	createBrick({ kind, item, hue, x, y, row, column }) {
		let color;
		let material;
		let geometry = this.brickGeometry;
		switch (kind) {
			case "tissue":
				color = new THREE.Color(this.stage.theme.tissue);
				material = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.15, roughness: 0.55, clearcoat: 0.6, transparent: true, opacity: 0.92 });
				break;
			case "redCell":
				color = new THREE.Color(0xff3344);
				geometry = this.redCellGeometry;
				material = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.3, clearcoat: 1 });
				break;
			case "ice":
				color = new THREE.Color(0x3d8fd6);
				material = new THREE.MeshPhysicalMaterial({
					color,
					emissive: 0x2a6fb0,
					emissiveIntensity: 0.2,
					transparent: true,
					opacity: 0.45,
					roughness: 0.35,
					iridescence: 0.4,
					iridescenceIOR: 1.3,
					depthWrite: false,
				});
				break;
			default: {
				const isArmored = kind === "armored";
				color = new THREE.Color().setHSL(hue, 0.95, isArmored ? 0.62 : 0.5);
				material = new THREE.MeshPhysicalMaterial({
					color,
					emissive: color,
					emissiveIntensity: isArmored ? 0.3 : 0.12,
					transparent: true,
					opacity: isArmored ? 0.45 : 0.25,
					roughness: 0.15,
					iridescence: 0.5,
					iridescenceIOR: 1.4,
					depthWrite: false,
				});
			}
		}

		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(x, y, 0);
		mesh.renderOrder = 2;

		let edges = null;
		if (kind !== "redCell") {
			edges = new THREE.LineSegments(
				this.brickEdgesGeometry,
				new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(kind === "tissue" ? 1.2 : 2.5), transparent: true, opacity: kind === "tissue" ? 0.5 : 0.9 }),
			);
			mesh.add(edges);
		}

		// Ice bricks show the item they hold, allergens show what they are.
		let icon = null;
		const iconMap = item ? this.iconTextures.get(ITEMS[item].icon) : kind === "allergen" || kind === "armored" ? this.getEmojiTexture(randomElement(this.stage.allergens)) : null;
		if (iconMap) {
			icon = new THREE.Mesh(
				this.brickIconGeometry,
				new THREE.MeshBasicMaterial({
					map: iconMap,
					color: item ? new THREE.Color(ITEMS[item].color).multiplyScalar(1.3) : new THREE.Color(0xffffff).multiplyScalar(0.85),
					transparent: true,
					depthWrite: false,
				}),
			);
			// On the front face, drawn after the (non depth-writing) glass so the surface doesn't wash it out.
			icon.position.z = BRICK_DEPTH / 2 + 0.02;
			icon.renderOrder = 3;
			mesh.add(icon);
		}
		this.scene.add(mesh);

		const maxHitPoints = kind === "armored" ? 2 : 1;
		return {
			mesh,
			edges,
			icon,
			kind,
			item,
			color,
			x,
			baseY: y,
			y,
			bobPhase: column * 0.9 + row,
			halfSize: BRICK_SIZE / 2,
			isBreakable: kind !== "tissue" && kind !== "redCell",
			maxHitPoints,
			hitPoints: maxHitPoints,
			baseOpacity: material.opacity,
			introDelay: Math.min(x, 24) * 0.012 + row * 0.02,
			alive: true,
			popTime: 0,
		};
	}

	getEmojiTexture(emoji) {
		let texture = this.emojiTextures.get(emoji);
		if (!texture) {
			texture = createEmojiTexture(emoji);
			this.emojiTextures.set(emoji, texture);
		}
		return texture;
	}

	createShards() {
		this.shardMesh = new THREE.InstancedMesh(
			new THREE.TetrahedronGeometry(0.16),
			new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
			SHARD_POOL_SIZE,
		);
		this.shardMesh.frustumCulled = false;
		const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
		const white = new THREE.Color(0xffffff);
		for (let index = 0; index < SHARD_POOL_SIZE; index++) {
			this.shardMesh.setMatrixAt(index, hidden);
			this.shardMesh.setColorAt(index, white);
			this.shards.push({
				life: 0,
				maxLife: 1,
				position: new THREE.Vector3(),
				velocity: new THREE.Vector3(),
				rotation: new THREE.Euler(),
				spin: new THREE.Vector3(),
				size: 1,
			});
		}
		this.nextShardIndex = 0;
		this.scene.add(this.shardMesh);
	}

	createDust() {
		this.dustMesh = new THREE.InstancedMesh(
			new THREE.OctahedronGeometry(0.05),
			new THREE.MeshBasicMaterial({ color: 0xffd0d8, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
			DUST_COUNT,
		);
		this.dustMesh.frustumCulled = false;
		for (let index = 0; index < DUST_COUNT; index++) {
			this.dust.push({
				position: new THREE.Vector3(randomBetween(-DUST_HALF_RANGE_X, DUST_HALF_RANGE_X), randomBetween(VIEW_BOTTOM_Y - 6, VIEW_TOP_Y + 6), randomBetween(-10, -1.5)),
				speed: randomBetween(0.3, 1.2),
				phase: Math.random() * Math.PI * 2,
			});
		}
		this.scene.add(this.dustMesh);
	}

	createPipeline() {
		this.pipeline = new THREE.RenderPipeline(this.renderer);
		const scenePass = pass(this.scene, this.camera);
		const sceneColor = scenePass.getTextureNode("output");
		const bloomColor = bloom(sceneColor, 0.9, 0.35, 0.3);
		// The canvas stays transparent so the page shows through. The scene pass holds
		// premultiplied colors, so un-premultiply before tone mapping / sRGB conversion
		// and premultiply again afterwards; otherwise translucent areas wash out.
		const premultipliedColor = sceneColor.rgb.add(bloomColor.rgb);
		const alpha = clamp(sceneColor.a.add(luminance(bloomColor.rgb)), 0, 1);
		const straightColor = premultipliedColor.div(max(alpha, 1e-4));
		const displayColor = renderOutput(vec4(straightColor, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
		this.pipeline.outputColorTransform = false;
		this.pipeline.outputNode = vec4(displayColor.rgb.mul(alpha), alpha);
	}

	// ----- Balls -----
	createBall(position, velocity = new THREE.Vector3()) {
		const color = BASE_BALL_COLOR.clone();
		const group = new THREE.Group();

		const photoSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.photoTexture, transparent: true }));
		photoSprite.scale.setScalar(BALL_RADIUS * 1.8);
		photoSprite.renderOrder = 1;

		const shell = new THREE.Mesh(
			this.ballShellGeometry,
			new THREE.MeshPhysicalMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: 0.07,
				roughness: 0,
				clearcoat: 1,
				iridescence: 1,
				iridescenceIOR: 1.3,
				depthWrite: false,
			}),
		);
		shell.renderOrder = 2;

		const glow = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: this.glowTexture,
				color,
				transparent: true,
				opacity: 0.45,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			}),
		);
		glow.scale.setScalar(BALL_RADIUS * 3.6);
		glow.renderOrder = 0;

		group.add(glow, photoSprite, shell);
		this.scene.add(group);

		const trail = Array.from({ length: TRAIL_LENGTH }, (_, index) => {
			const mesh = new THREE.Mesh(
				this.trailGeometry,
				new THREE.MeshBasicMaterial({
					color,
					transparent: true,
					opacity: 0.35 * (1 - index / TRAIL_LENGTH),
					blending: THREE.AdditiveBlending,
					depthWrite: false,
				}),
			);
			mesh.visible = false;
			this.scene.add(mesh);
			return mesh;
		});

		const ball = { position: position.clone(), velocity: velocity.clone(), spin: 0, airTime: 0, color, group, photoSprite, shell, glow, trail, history: [] };
		this.balls.push(ball);
		return ball;
	}

	removeBall(ball) {
		this.scene.remove(ball.group);
		for (const mesh of ball.trail) {
			this.scene.remove(mesh);
			mesh.material.dispose();
		}
		ball.photoSprite.material.dispose();
		ball.shell.material.dispose();
		ball.glow.material.dispose();
		this.balls.splice(this.balls.indexOf(ball), 1);
	}

	resetBalls() {
		while (this.balls.length > 0) {
			this.removeBall(this.balls[0]);
		}
		this.createBall(this.restingBallPosition());
	}

	restingBallPosition() {
		return new THREE.Vector3(this.paddleX, PADDLE_Y + PADDLE_HEIGHT / 2 + BALL_RADIUS + 0.02, 0);
	}

	isGhost(ball) {
		return ball.airTime > GHOST_AFTER_SECONDS;
	}

	// ----- Input -----
	bindEvents() {
		this.handlePointerMove = (event) => {
			// Converted to a field position every frame, since the camera keeps moving.
			this.pointerClient = { x: event.clientX, y: event.clientY };
		};
		this.handlePointerDown = (event) => {
			this.sound.resume();
			this.handlePointerMove(event);
			this.handleAction();
		};
		this.handleKeyDown = (event) => {
			this.sound.resume();
			if (event.key === "Escape") {
				this.close();
			} else if (event.key === "p" || event.key === "P") {
				this.togglePause();
			} else if (IS_LOCAL_DEVELOPMENT && /^[1-9]$/.test(event.key) && Number(event.key) <= STAGES.length) {
				this.jumpToStage(Number(event.key) - 1);
			} else if (this.isPaused && this.handlePausedInput(event.key.length === 1 ? event.key.toLowerCase() : event.key)) {
				event.preventDefault();
			} else if (event.key === " " || event.key === "Enter") {
				event.preventDefault();
				this.handleAction();
			} else if (event.key === "m" || event.key === "M") {
				this.toggleMute();
			} else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				event.preventDefault();
				this.pointerClient = null;
				this.keysHeld.add(event.key);
			}
		};
		this.handleKeyUp = (event) => this.keysHeld.delete(event.key);
		this.handleResize = () => {
			this.renderer.setSize(window.innerWidth, window.innerHeight);
			this.fitCamera();
		};
		this.handleClose = () => this.close();
		this.handleMute = () => this.toggleMute();
		this.handlePauseButton = () => this.togglePause();
		this.handleVisibilityChange = () => {
			if (document.hidden) {
				this.pause();
			}
		};

		const canvas = this.renderer.domElement;
		canvas.addEventListener("pointermove", this.handlePointerMove);
		canvas.addEventListener("pointerdown", this.handlePointerDown);
		window.addEventListener("keydown", this.handleKeyDown);
		window.addEventListener("keyup", this.handleKeyUp);
		window.addEventListener("resize", this.handleResize);
		this.closeButton.addEventListener("click", this.handleClose);
		this.muteButton.addEventListener("click", this.handleMute);
		this.pauseButton.addEventListener("click", this.handlePauseButton);
		document.addEventListener("visibilitychange", this.handleVisibilityChange);
	}

	unbindEvents() {
		if (this.renderer) {
			this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
			this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
		}
		window.removeEventListener("keydown", this.handleKeyDown);
		window.removeEventListener("keyup", this.handleKeyUp);
		window.removeEventListener("resize", this.handleResize);
		this.closeButton.removeEventListener("click", this.handleClose);
		this.muteButton.removeEventListener("click", this.handleMute);
		this.pauseButton.removeEventListener("click", this.handlePauseButton);
		document.removeEventListener("visibilitychange", this.handleVisibilityChange);
	}

	handleAction() {
		if (this.isPaused) {
			this.resume();
			return;
		}
		switch (this.state) {
			case "ready":
				this.launchBall();
				break;
			case "playing":
				this.fireBeam();
				break;
			case "stageClear":
				this.stageIndex += 1;
				this.buildStage();
				this.startStage();
				break;
			case "over":
			case "complete":
				this.stageIndex = 0;
				this.score = 0;
				this.lives = INITIAL_LIVES;
				this.totalClearTime = 0;
				this.isMaxPower = false;
				this.buildStage();
				this.startStage();
				break;
		}
	}

	toggleMute() {
		this.sound.toggleMuted();
		this.updateMuteButton();
	}

	updateMuteButton() {
		const muted = this.sound.muted;
		this.muteButton.textContent = muted ? "🔇" : "🔊";
		this.muteButton.setAttribute("aria-label", muted ? "Unmute" : "Mute");
	}

	/** Development shortcut (localhost only): restarts the run at the given stage. */
	jumpToStage(index) {
		if (this.state === "loading" || this.state === "closed") {
			return;
		}
		this.isPaused = false;
		this.updatePauseButton();
		this.stageIndex = index;
		this.stageStartedAt = 0;
		this.buildStage();
		this.startStage();
	}

	// ----- Pause -----
	get canPause() {
		return this.state === "intro" || this.state === "ready" || this.state === "playing";
	}

	togglePause() {
		if (this.isPaused) {
			this.resume();
		} else {
			this.pause();
		}
	}

	pause() {
		if (this.isPaused || !this.canPause) {
			return;
		}
		this.isPaused = true;
		this.pausedAt = performance.now();
		this.messageBeforePause = this.messageBox.textContent;
		this.recentPausedKeys = [];
		this.keysHeld.clear();
		this.showPausedMessage();
		this.sound.stopMusic();
		this.sound.pauseChime();
		this.updatePauseButton();
	}

	resume() {
		if (!this.isPaused) {
			return;
		}
		this.isPaused = false;
		const now = performance.now();
		// The paused time doesn't count towards the clear time.
		if (this.stageStartedAt !== 0) {
			this.stageStartedAt += now - this.pausedAt;
		}
		this.lastFrameTime = now;
		this.setMessage(this.messageBeforePause);
		this.sound.startMusic(this.stage);
		this.sound.pauseChime();
		this.updatePauseButton();
	}

	showPausedMessage() {
		this.setMessage(`PAUSED${this.isMaxPower ? "\n★ MAX POWER ★" : ""}\n${this.isGamepadConnected ? "Start" : "P / ⏸"} to resume`);
	}

	updatePauseButton() {
		this.pauseButton.textContent = this.isPaused ? "▶" : "⏸";
		this.pauseButton.setAttribute("aria-label", this.isPaused ? "Resume" : "Pause");
	}

	/**
	 * Keys (and gamepad buttons) pressed while paused are checked for the Konami code.
	 * @param {string} key - a key name such as "ArrowUp" or a lower-case letter
	 * @returns {boolean} true when the key was used here (and must not reach the game)
	 */
	handlePausedInput(key) {
		if (!KONAMI_CODE.includes(key)) {
			return false;
		}
		this.recentPausedKeys = [...this.recentPausedKeys, key].slice(-KONAMI_CODE.length);
		const entered = this.recentPausedKeys.join();
		if (KONAMI_CODES.some((code) => code.join() === entered)) {
			this.recentPausedKeys = [];
			this.activateMaxPower();
		}
		return true;
	}

	activateMaxPower() {
		this.isMaxPower = true;
		this.sound.maxPower();
		this.showPausedMessage();
	}

	// ----- Camera -----
	fitCamera() {
		const aspect = window.innerWidth / window.innerHeight;
		const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
		const halfHeight = (VIEW_TOP_Y - VIEW_BOTTOM_Y) / 2 + 0.4;
		this.cameraDistance = Math.max(halfHeight / tanHalfFov, MIN_HALF_VIEW_WIDTH / (tanHalfFov * aspect));
		this.halfViewWidth = this.cameraDistance * tanHalfFov * aspect;
		this.camera.aspect = aspect;
		this.camera.updateProjectionMatrix();
		this.cameraX = this.clampCameraX(this.cameraX);
		this.placeCamera(0, 0);
	}

	clampCameraX(x) {
		const margin = this.halfViewWidth - 0.6;
		if (this.levelWidth - this.leftBoundX <= margin * 2) {
			return (this.leftBoundX + this.levelWidth) / 2;
		}
		return THREE.MathUtils.clamp(x, this.leftBoundX + margin, this.levelWidth - margin);
	}

	placeCamera(swayX, swayY) {
		this.camera.position.set(this.cameraX + swayX, VIEW_CENTER_Y - this.cameraDistance * 0.12 + swayY, this.cameraDistance);
		this.camera.lookAt(this.cameraX, VIEW_CENTER_Y, 0);
		this.camera.updateMatrixWorld();
	}

	screenToField(clientX, clientY) {
		this.pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const point = new THREE.Vector3();
		return this.raycaster.ray.intersectPlane(this.fieldPlane, point) ?? point;
	}

	// ----- State -----
	startStage() {
		this.clearEffects();
		if (this.balls.length > 0) {
			this.ballIntroFrom.copy(this.balls[0].position);
		}
		this.paddleX = PADDLE_START_X;
		this.paddleTargetX = PADDLE_START_X;
		this.cameraX = this.clampCameraX(PADDLE_START_X);
		this.placeCamera(0, 0);
		this.resetBalls();
		this.stageTime = 0;
		this.sound.startMusic(this.stage);
		this.setState("intro");
		this.showToast(this.stage.name);
	}

	clearEffects() {
		this.wideTime = 0;
		this.itchTime = 0;
		this.guardTime = 0;
		this.beamTime = 0;
		for (const item of this.items) {
			this.disposeItem(item);
		}
		this.items = [];
		for (const beam of this.beams) {
			this.scene.remove(beam.mesh);
		}
		this.beams = [];
		this.clearHistamines();
	}

	clearHistamines() {
		for (const histamine of this.histamines) {
			this.scene.remove(histamine.mesh);
		}
		this.histamines = [];
	}

	setState(state) {
		this.state = state;
		this.stateTime = 0;
		const isTouch = matchMedia("(pointer: coarse)").matches;
		switch (state) {
			case "intro":
				this.combo = 0;
				this.setMessage("");
				break;
			case "ready":
				this.setMessage(
					`${this.stage.boss ? "Defeat the mast cell and reach the gate" : "Carry the ball to the lymph node gate"} ➜\n` +
						(this.isGamepadConnected
							? "Ⓐ to launch · Start to pause"
							: isTouch
								? "Tap to launch"
								: "Click / Space to launch\nP to pause · M to mute · Esc to exit"),
				);
				break;
			case "playing":
				this.setMessage("");
				break;
			case "stageClear":
				this.setMessage(`${this.stage.name} CLEAR! ✨\nTime ${formatNanoseconds(this.lastClearTime)}\nClick for ${STAGES[this.stageIndex + 1].name}`);
				break;
			case "complete":
				this.setMessage(
					`ALL CLEAR! 🎉\nTime ${formatNanoseconds(this.lastClearTime)}\nTotal ${formatNanoseconds(this.totalClearTime)}\nScore ${this.score.toLocaleString()}${this.isMaxPower ? " (MAX POWER)" : ""}\nClick to play again · Esc to exit`,
				);
				break;
			case "over":
				this.setMessage(`GAME OVER\nScore ${this.score.toLocaleString()}\nClick to retry · Esc to exit`);
				break;
		}
		this.updateHud();
	}

	setMessage(text) {
		this.messageBox.textContent = text;
	}

	showToast(text) {
		this.toast.textContent = text;
		this.toast.classList.remove("is-visible");
		void this.toast.offsetWidth;
		this.toast.classList.add("is-visible");
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => this.toast.classList.remove("is-visible"), TOAST_DURATION_MS);
	}

	updateHud() {
		this.scoreLabel.textContent = `SCORE ${this.score.toLocaleString()}`;
		this.livesLabel.textContent = "♥".repeat(Math.max(this.lives, 0));
		this.stageLabel.textContent = `${this.stageIndex + 1}/${STAGES.length}`;
		this.comboLabel.textContent = this.combo >= 2 ? `COMBO ×${this.combo}` : "";
		const bossText = this.boss && this.boss.hitPoints > 0 ? `MAST CELL ${"▮".repeat(this.boss.hitPoints)}${"▯".repeat(BOSS_HIT_POINTS - this.boss.hitPoints)}` : "";
		if (this.bossLabel.textContent !== bossText) {
			this.bossLabel.textContent = bossText;
		}
	}

	updateProgressLabel() {
		const ballX = this.leadBall?.position.x ?? this.paddleX;
		const text = `➜ ${Math.round(clamp01(ballX / this.goalX) * 100)}%`;
		if (this.progressLabel.textContent !== text) {
			this.progressLabel.textContent = text;
		}
	}

	updateEffectsLabel() {
		// MAX POWER keeps the item effects on for good, so their timers aren't shown.
		const timedEffects = this.isMaxPower
			? [[this.itchTime, "ITCHY"]]
			: [
					[this.wideTime, ITEMS.wide.label],
					[this.itchTime, "ITCHY"],
					[this.guardTime, ITEMS.guard.label],
					[this.beamTime, ITEMS.beam.label],
				];
		const effects = timedEffects.filter(([time]) => time > 0).map(([time, label]) => `${label} ${Math.ceil(time)}`);
		const text = [...(this.isMaxPower ? ["★ MAX POWER"] : []), ...effects].join(" · ");
		if (this.effectsLabel.textContent !== text) {
			this.effectsLabel.textContent = text;
		}
	}

	launchBall() {
		const [ball] = this.balls;
		const angle = randomBetween(0.2, 0.4);
		ball.velocity.set(Math.sin(angle), Math.cos(angle), 0).multiplyScalar(BALL_LAUNCH_SPEED);
		ball.airTime = 0;
		this.guardTime = Math.max(this.guardTime, LAUNCH_GUARD_DURATION);
		// The clear time counts from the first launch of the stage (including lost balls).
		if (this.stageStartedAt === 0) {
			this.stageStartedAt = performance.now();
		}
		this.sound.launch();
		this.setState("playing");
	}

	// ----- Frame -----
	tick() {
		const now = performance.now();
		const deltaTime = Math.min((now - this.lastFrameTime) / 1000, 1 / 30);
		this.lastFrameTime = now;
		this.pollGamepad();
		if (this.isPaused) {
			this.pipeline.render();
			return;
		}
		this.stateTime += deltaTime;
		this.stageTime += deltaTime;

		this.updateEffects(deltaTime);
		this.updateCamera(deltaTime);
		this.updatePaddle(deltaTime);
		this.updateBallState(deltaTime);
		this.updateBoss(deltaTime);
		this.updateHistamines(deltaTime);
		this.updateBeams(deltaTime);
		this.updateItems(deltaTime);
		this.updateBricks(deltaTime);
		this.updateLevel(deltaTime);
		this.updateShards(deltaTime);
		this.updateDust(deltaTime);
		this.updateBallVisuals(deltaTime);
		this.updateProgressLabel();

		this.pipeline.render();
	}

	updateEffects(deltaTime) {
		if (this.isMaxPower) {
			this.wideTime = MAX_POWER_EFFECT_TIME;
			this.guardTime = MAX_POWER_EFFECT_TIME;
			this.beamTime = MAX_POWER_EFFECT_TIME;
		}
		if (this.state === "playing") {
			this.wideTime = Math.max(this.wideTime - deltaTime, 0);
			this.itchTime = Math.max(this.itchTime - deltaTime, 0);
			this.guardTime = Math.max(this.guardTime - deltaTime, 0);
			this.beamTime = Math.max(this.beamTime - deltaTime, 0);
		}
		this.beamCooldown = Math.max(this.beamCooldown - deltaTime, 0);

		const guardBlink = this.guardTime > 0 && this.guardTime < 3 && Math.floor(this.guardTime * 8) % 2 === 0;
		this.guard.visible = this.guardTime > 0 && !guardBlink;
		this.guard.position.x = this.cameraX;
		this.guard.scale.x = this.halfViewWidth * 2 + 2;
		this.guardMaterial.emissiveIntensity = THREE.MathUtils.damp(this.guardMaterial.emissiveIntensity, 2, 6, deltaTime);
		this.updateEffectsLabel();
	}

	/** Gamepad: stick / D-pad move the paddle, the bottom face button acts, Start pauses. */
	pollGamepad() {
		const { isConnected, move, justPressed } = this.gamepad.poll();
		this.isGamepadConnected = isConnected;
		this.gamepadMove = this.isPaused ? 0 : move;
		if (move !== 0) {
			this.pointerClient = null;
		}
		if (justPressed.has("start")) {
			this.togglePause();
		} else if (this.isPaused) {
			for (const button of justPressed) {
				const key = GAMEPAD_CHEAT_KEYS[button];
				if (key) {
					this.handlePausedInput(key);
				}
			}
		} else if (justPressed.has("faceBottom")) {
			this.handleAction();
		}
	}

	updatePaddle(deltaTime) {
		if (this.pointerClient) {
			this.paddleTargetX = this.screenToField(this.pointerClient.x, this.pointerClient.y).x;
		}
		if (this.keysHeld.has("ArrowLeft")) {
			this.paddleTargetX -= PADDLE_KEYBOARD_SPEED * deltaTime;
		}
		if (this.keysHeld.has("ArrowRight")) {
			this.paddleTargetX += PADDLE_KEYBOARD_SPEED * deltaTime;
		}
		this.paddleTargetX += this.gamepadMove * PADDLE_KEYBOARD_SPEED * deltaTime;
		const sizeFactor = (this.wideTime > 0 ? WIDE_FACTOR : 1) * (this.itchTime > 0 ? ITCH_FACTOR : 1);
		this.paddleWidth = THREE.MathUtils.damp(this.paddleWidth, PADDLE_WIDTH * sizeFactor, 8, deltaTime);

		// The paddle stays on screen.
		const viewLimit = this.halfViewWidth - this.paddleWidth / 2 - 0.3;
		this.paddleTargetX = THREE.MathUtils.clamp(this.paddleTargetX, this.cameraX - viewLimit, this.cameraX + viewLimit);
		const previousX = this.paddleX;
		this.paddleX = THREE.MathUtils.damp(this.paddleX, this.paddleTargetX, 20, deltaTime);
		this.paddleVelocity = (this.paddleX - previousX) / Math.max(deltaTime, 1e-3);
		this.paddle.position.x = this.paddleX;
		this.paddle.scale.x = this.paddleWidth / PADDLE_WIDTH;
		this.paddle.rotation.y = THREE.MathUtils.clamp(this.paddleVelocity * 0.03, -0.5, 0.5);
		this.paddleMaterial.emissiveIntensity = THREE.MathUtils.damp(this.paddleMaterial.emissiveIntensity, 0.8, 6, deltaTime);
		this.paddleMaterial.emissive.setHex(this.itchTime > 0 ? 0xff66dd : this.isMaxPower ? 0xffcc44 : 0x44bbff);

		for (const emitter of this.beamEmitters) {
			emitter.visible = this.beamTime > 0;
			emitter.position.set(this.paddleX + emitter.userData.side * (this.paddleWidth / 2 - 0.25), PADDLE_Y + 0.3, 0);
		}
	}

	updateBallState(deltaTime) {
		switch (this.state) {
			case "intro": {
				const progress = clamp01(this.stateTime / INTRO_DURATION);
				const [ball] = this.balls;
				ball.position.lerpVectors(this.ballIntroFrom, this.restingBallPosition(), easeOutCubic(progress));
				ball.position.z = Math.sin(progress * Math.PI) * 4;
				ball.spin += deltaTime * 12 * (1 - progress);
				if (progress >= 1) {
					this.setState("ready");
				}
				break;
			}
			case "ready": {
				const [ball] = this.balls;
				ball.position.copy(this.restingBallPosition());
				ball.position.y += Math.sin(this.stateTime * 4) * 0.05;
				break;
			}
			case "playing":
				for (const ball of [...this.balls]) {
					this.stepBall(ball, deltaTime);
				}
				if (this.state === "playing" && this.balls.length === 0) {
					this.loseLife();
				}
				break;
			default:
				break;
		}
	}

	stepBall(ball, deltaTime) {
		// Sub-steps keep a falling ball from tunnelling through bricks.
		const travel = (ball.velocity.length() + GRAVITY * deltaTime) * deltaTime;
		const steps = Math.max(1, Math.ceil(travel / (BALL_RADIUS * 0.5)));
		const stepTime = deltaTime / steps;
		for (let step = 0; step < steps && this.state === "playing"; step++) {
			ball.velocity.y -= GRAVITY * stepTime;
			ball.position.addScaledVector(ball.velocity, stepTime);
			this.collideWithBounds(ball);
			this.collideWithGuard(ball);
			this.collideWithPaddle(ball);
			if (!this.isGhost(ball)) {
				this.collideWithBricks(ball);
			}
			this.collideWithBoss(ball);
			if (ball.velocity.length() > BALL_MAX_SPEED) {
				ball.velocity.setLength(BALL_MAX_SPEED);
			}
			if (!this.isGoalLocked && ball.position.x >= this.goalX) {
				this.clearStage();
				return;
			}
			if (ball.position.y < BALL_LOST_Y) {
				this.spawnShards(ball.position, LOST_BALL_COLOR, 20, 8);
				this.removeBall(ball);
				if (this.balls.length > 0) {
					this.sound.wall();
				}
				return;
			}
		}
		ball.airTime += deltaTime;
		ball.spin += (ball.velocity.x >= 0 ? -1 : 1) * ball.velocity.length() * deltaTime * 0.6;
	}

	collideWithBounds(ball) {
		const { position, velocity } = ball;
		let hit = false;
		if (position.x - BALL_RADIUS < this.leftBoundX) {
			position.x = this.leftBoundX + BALL_RADIUS;
			velocity.x = Math.abs(velocity.x);
			hit = true;
		} else if (this.isGoalLocked && position.x + BALL_RADIUS > this.goalX) {
			position.x = this.goalX - BALL_RADIUS;
			velocity.x = -Math.abs(velocity.x);
			this.barrierMaterial.opacity = 0.9;
			hit = true;
		} else if (position.x + BALL_RADIUS > this.levelWidth) {
			position.x = this.levelWidth - BALL_RADIUS;
			velocity.x = -Math.abs(velocity.x);
			hit = true;
		}
		if (position.y + BALL_RADIUS > CEILING_Y) {
			position.y = CEILING_Y - BALL_RADIUS;
			velocity.y = -Math.abs(velocity.y);
			hit = true;
		}
		if (hit) {
			this.wallMaterial.emissiveIntensity = 5;
			this.spawnShards(position, BASE_BALL_COLOR, 4, 2);
			this.sound.wall();
		}
	}

	collideWithGuard(ball) {
		const { position, velocity } = ball;
		if (this.guardTime <= 0 || velocity.y >= 0 || position.y - BALL_RADIUS > GUARD_Y + 0.07 || position.y < GUARD_Y - 0.5) {
			return;
		}
		position.y = GUARD_Y + 0.07 + BALL_RADIUS;
		velocity.y = Math.max(Math.abs(velocity.y), BALL_LAUNCH_SPEED * 0.8);
		ball.airTime = 0;
		this.guardMaterial.emissiveIntensity = 6;
		this.spawnShards(position, new THREE.Color(ITEMS.guard.color), 10, 4);
		this.sound.guard();
	}

	collideWithPaddle(ball) {
		const { position, velocity } = ball;
		if (velocity.y >= 0) {
			return;
		}
		const paddleTop = PADDLE_Y + PADDLE_HEIGHT / 2;
		const reach = this.paddleWidth / 2 + BALL_RADIUS + PADDLE_CATCH_MARGIN;
		const offsetX = position.x - this.paddleX;
		if (position.y - BALL_RADIUS > paddleTop || position.y < PADDLE_Y - PADDLE_HEIGHT || Math.abs(offsetX) > reach) {
			return;
		}
		// Where the ball lands on the paddle decides the direction: right edge = far to the right.
		const angle = THREE.MathUtils.clamp(offsetX / reach, -1, 1) * MAX_BOUNCE_ANGLE;
		velocity.set(Math.sin(angle) * BALL_LAUNCH_SPEED + this.paddleVelocity * PADDLE_VELOCITY_TRANSFER, Math.cos(angle) * BALL_LAUNCH_SPEED, 0);
		position.y = paddleTop + BALL_RADIUS;
		ball.airTime = 0;
		this.combo = 0;
		this.paddleMaterial.emissiveIntensity = 3;
		this.cameraShake += 0.05;
		this.sound.paddle();
		this.updateHud();
	}

	collideWithBricks(ball) {
		const { position, velocity } = ball;
		for (const brick of this.bricks) {
			if (!brick.alive || Math.abs(position.x - brick.x) > BRICK_COLLISION_REACH || Math.abs(position.y - brick.y) > BRICK_COLLISION_REACH) {
				continue;
			}
			const closestX = THREE.MathUtils.clamp(position.x, brick.x - brick.halfSize, brick.x + brick.halfSize);
			const closestY = THREE.MathUtils.clamp(position.y, brick.y - brick.halfSize, brick.y + brick.halfSize);
			const distanceX = position.x - closestX;
			const distanceY = position.y - closestY;
			if (distanceX * distanceX + distanceY * distanceY > BALL_RADIUS * BALL_RADIUS) {
				continue;
			}
			const directionX = position.x >= brick.x ? 1 : -1;
			const directionY = position.y >= brick.y ? 1 : -1;
			const overlapX = brick.halfSize + BALL_RADIUS - Math.abs(position.x - brick.x);
			const overlapY = brick.halfSize + BALL_RADIUS - Math.abs(position.y - brick.y);
			const isSideHit = overlapX < overlapY;
			// A brick that breaks from a side hit doesn't push the ball back: it smashes through
			// and keeps travelling, so the stage doesn't feel like it is shoving the player back.
			// With MAX POWER the ball smashes through breaking bricks from any direction.
			const smashesThrough = (isSideHit || this.isMaxPower) && brick.isBreakable && brick.hitPoints === 1;
			if (isSideHit && !smashesThrough) {
				velocity.x = directionX * Math.abs(velocity.x);
				position.x += directionX * overlapX;
			} else if (!isSideHit) {
				velocity.y = directionY * Math.abs(velocity.y);
				position.y += directionY * overlapY;
			}
			this.hitBrick(brick, ball.color);
			return;
		}
	}

	collideWithBoss(ball) {
		const { boss } = this;
		if (!boss || boss.hitPoints <= 0) {
			return;
		}
		const offset = ball.position.clone().sub(boss.position);
		const distance = offset.length();
		if (distance > BOSS_RADIUS + BALL_RADIUS || distance === 0) {
			return;
		}
		const normal = offset.divideScalar(distance);
		ball.position.copy(boss.position).addScaledVector(normal, BOSS_RADIUS + BALL_RADIUS);
		const approach = ball.velocity.dot(normal);
		if (approach < 0) {
			ball.velocity.addScaledVector(normal, -2 * approach);
		}
		this.damageBoss(ball.color);
	}

	/**
	 * @param {object} brick
	 * @param {THREE.Color} [ballColor] - tinted with the brick color when a ball hits it
	 */
	hitBrick(brick, ballColor) {
		if (!brick.isBreakable) {
			brick.mesh.material.emissiveIntensity = 1.5;
			this.spawnShards(brick.mesh.position, brick.color, 4, 3);
			this.cameraShake += 0.04;
			this.sound.steel();
			return;
		}

		brick.hitPoints -= 1;
		this.combo += 1;
		ballColor?.copy(brick.color);
		this.ballLight.intensity = 90;
		this.cameraShake += 0.12;

		if (brick.hitPoints > 0) {
			brick.mesh.material.opacity = brick.baseOpacity * 0.55;
			brick.mesh.material.emissiveIntensity = 2.5;
			this.score += 5 * this.combo;
			this.spawnShards(brick.mesh.position, brick.color, SHARDS_PER_BRICK / 2, 4);
			this.sound.armor();
			this.sound.brick(this.combo);
		} else {
			brick.alive = false;
			brick.popTime = 0.0001;
			this.score += (brick.kind === "armored" ? 20 : 10) * this.combo;
			if (brick.kind === "ice") {
				this.spawnShards(brick.mesh.position, new THREE.Color(0xcfeeff), SHARDS_PER_BRICK * 1.5, 8);
				this.spawnItem(brick.item, brick.mesh.position);
				this.sound.ice();
			} else {
				this.spawnShards(brick.mesh.position, brick.color, SHARDS_PER_BRICK, 7);
				this.sound.brick(this.combo);
				if (Math.random() < RANDOM_DROP_CHANCE) {
					this.spawnItem(randomItem(), brick.mesh.position);
				}
			}
		}
		this.updateHud();
	}

	damageBoss(color) {
		const { boss } = this;
		if (boss.hitCooldown > 0) {
			return;
		}
		boss.hitCooldown = BOSS_HIT_COOLDOWN;
		boss.hitPoints -= 1;
		boss.flash = 1;
		this.score += 30;
		this.cameraShake += 0.2;
		this.spawnShards(boss.position, new THREE.Color(0xff66dd), 14, 6);
		if (color) {
			color.setHex(0xff66dd);
		}
		if (boss.hitPoints > 0) {
			this.sound.bossHit();
		} else {
			boss.deathTime = 0.0001;
			this.score += 1000;
			this.clearHistamines();
			this.sound.bossDown();
			this.showToast("MAST CELL DOWN!");
			this.openEpilogue();
			for (let burst = 0; burst < 5; burst++) {
				this.spawnShards(boss.position, new THREE.Color().setHSL(0.8 + burst * 0.04, 0.9, 0.65), 40, 10);
			}
			this.cameraShake += 0.8;
		}
		this.updateHud();
	}

	clearStage() {
		this.lastClearTime = performance.now() - this.stageStartedAt;
		this.totalClearTime += this.lastClearTime;
		this.stageStartedAt = 0;
		this.clearEffects();
		while (this.balls.length > 1) {
			this.removeBall(this.balls[this.balls.length - 1]);
		}
		this.celebrate();
		this.sound.stopMusic();
		if (this.stageIndex + 1 < STAGES.length) {
			this.sound.stageClear();
			this.setState("stageClear");
		} else {
			this.sound.allClear();
			this.celebrate();
			this.setState("complete");
		}
	}

	loseLife() {
		this.lives -= 1;
		this.combo = 0;
		this.cameraShake += 0.5;
		this.clearEffects();
		this.sound.loseBall();
		this.createBall(this.restingBallPosition());
		if (this.lives > 0) {
			this.setState("ready");
		} else {
			this.sound.stopMusic();
			this.sound.gameOver();
			this.setState("over");
		}
	}

	celebrate() {
		const palette = BRICK_ROW_HUES.map((hue) => new THREE.Color().setHSL(hue, 0.9, 0.65));
		for (let burst = 0; burst < 8; burst++) {
			const origin = new THREE.Vector3(this.cameraX + randomBetween(-this.halfViewWidth, this.halfViewWidth), randomBetween(VIEW_CENTER_Y, CEILING_Y), randomBetween(-1, 2));
			this.spawnShards(origin, palette[burst % palette.length], 40, 11);
		}
		this.cameraShake += 0.6;
	}

	// ----- Boss -----
	updateBoss(deltaTime) {
		const { boss } = this;
		if (!boss) {
			return;
		}
		const time = performance.now() / 1000;
		if (boss.deathTime > 0) {
			boss.deathTime += deltaTime;
			const progress = clamp01(boss.deathTime / 0.6);
			this.bossGroup.scale.setScalar(1 + progress * 0.6);
			this.bossShellMaterial.opacity = 0.35 * (1 - progress);
			this.bossGroup.visible = progress < 1;
			this.barrierMaterial.opacity = 0.4 * (1 - progress);
			return;
		}

		boss.position.y = BOSS_BASE_Y + Math.sin(this.stageTime * BOSS_BOB_SPEED) * BOSS_BOB_AMPLITUDE;
		boss.hitCooldown = Math.max(boss.hitCooldown - deltaTime, 0);
		boss.flash = Math.max(boss.flash - deltaTime * 4, 0);
		this.bossGroup.position.copy(boss.position);
		this.bossGroup.rotation.set(Math.sin(time * 0.7) * 0.3, time * 0.5, 0);
		this.bossGranules.rotation.y = -time * 1.3;
		const pulse = 1 + Math.sin(time * 3) * 0.03 + boss.flash * 0.12;
		this.bossGroup.scale.setScalar(pulse);
		this.bossShellMaterial.emissiveIntensity = 0.4 + boss.flash * 3;
		this.barrierMaterial.opacity = THREE.MathUtils.damp(this.barrierMaterial.opacity, 0.35 + Math.sin(time * 4) * 0.08, 5, deltaTime);

		// It only degranulates while it's on screen and the ball is in play.
		const isOnScreen = Math.abs(boss.position.x - this.cameraX) < this.halfViewWidth + 1;
		if (this.state === "playing" && isOnScreen) {
			boss.releaseTimer -= deltaTime;
			if (boss.releaseTimer <= 0) {
				boss.releaseTimer = HISTAMINE_INTERVAL * randomBetween(0.7, 1.2);
				this.releaseHistamine();
			}
		}
	}

	releaseHistamine() {
		const mesh = new THREE.Mesh(this.histamineGeometry, this.histamineMaterial);
		mesh.position.copy(this.boss.position);
		mesh.position.y -= BOSS_RADIUS * 0.8;
		this.scene.add(mesh);
		// Aimed roughly at the paddle so it has to be dodged.
		const towardsPaddle = THREE.MathUtils.clamp((this.paddleX - mesh.position.x) * 0.6, -6, 6);
		this.histamines.push({ mesh, velocity: new THREE.Vector3(towardsPaddle + randomBetween(-1.5, 1.5), randomBetween(1, 3), 0) });
		this.bossShellMaterial.emissiveIntensity = 1.5;
		this.sound.histamine();
	}

	updateHistamines(deltaTime) {
		const paddleTop = PADDLE_Y + PADDLE_HEIGHT / 2;
		this.histamines = this.histamines.filter((histamine) => {
			histamine.velocity.y -= HISTAMINE_GRAVITY * deltaTime;
			histamine.mesh.position.addScaledVector(histamine.velocity, deltaTime);
			const { x, y } = histamine.mesh.position;
			const hitsPaddle = y - HISTAMINE_RADIUS <= paddleTop && y + HISTAMINE_RADIUS >= PADDLE_Y - PADDLE_HEIGHT / 2 && Math.abs(x - this.paddleX) <= this.paddleWidth / 2 + HISTAMINE_RADIUS;
			if (hitsPaddle) {
				this.itchTime = ITCH_DURATION;
				this.cameraShake += 0.2;
				this.spawnShards(histamine.mesh.position, new THREE.Color(0xff66dd), 16, 5);
				this.sound.itch();
				this.showToast("ITCHY!");
			}
			if (hitsPaddle || y < BALL_LOST_Y) {
				this.scene.remove(histamine.mesh);
				return false;
			}
			return true;
		});
	}

	// ----- Items -----
	spawnItem(type, origin) {
		const definition = ITEMS[type];
		const color = new THREE.Color(definition.color);
		const group = new THREE.Group();

		const glow = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: this.glowTexture, color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
		);
		glow.scale.setScalar(ITEM_RADIUS * 4);
		const icon = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: this.iconTextures.get(definition.icon), color: color.clone().multiplyScalar(1.5), transparent: true, depthWrite: false }),
		);
		icon.scale.setScalar(ITEM_RADIUS * 1.9);
		icon.renderOrder = 1;
		const shell = new THREE.Mesh(
			this.itemShellGeometry,
			new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.18, roughness: 0, clearcoat: 1, iridescence: 1, depthWrite: false }),
		);
		shell.renderOrder = 2;
		group.add(glow, icon, shell);
		group.position.copy(origin);
		this.scene.add(group);
		this.items.push({ type, group, icon, glow, shell, age: 0 });
	}

	disposeItem(item) {
		this.scene.remove(item.group);
		item.glow.material.dispose();
		item.icon.material.dispose();
		item.shell.material.dispose();
	}

	updateItems(deltaTime) {
		const paddleTop = PADDLE_Y + PADDLE_HEIGHT / 2;
		this.items = this.items.filter((item) => {
			item.age += deltaTime;
			item.group.position.y -= ITEM_FALL_SPEED * deltaTime;
			item.group.position.z = Math.sin(item.age * 3) * 0.2;
			item.shell.rotation.y += deltaTime * 2;
			item.icon.material.rotation = Math.sin(item.age * 4) * 0.25;
			const { x, y } = item.group.position;

			const caught = y - ITEM_RADIUS <= paddleTop && y + ITEM_RADIUS >= PADDLE_Y - PADDLE_HEIGHT / 2 && Math.abs(x - this.paddleX) <= this.paddleWidth / 2 + ITEM_RADIUS;
			if (caught) {
				this.applyItem(item.type);
				this.spawnShards(item.group.position, new THREE.Color(ITEMS[item.type].color), 24, 6);
				this.disposeItem(item);
				return false;
			}
			if (y < BALL_LOST_Y) {
				this.disposeItem(item);
				return false;
			}
			return true;
		});
	}

	applyItem(type) {
		this.sound.pickup();
		this.showToast(ITEMS[type].label);
		this.paddleMaterial.emissiveIntensity = 4;
		switch (type) {
			case "multiBall":
				for (const ball of [...this.balls]) {
					for (const angle of [-0.35, 0.35]) {
						if (this.balls.length >= MAX_BALLS) {
							break;
						}
						const velocity = ball.velocity.clone().applyAxisAngle(Z_AXIS, angle);
						this.createBall(ball.position, velocity);
					}
				}
				break;
			case "wide":
				this.wideTime = WIDE_DURATION;
				this.itchTime = 0;
				break;
			case "guard":
				this.guardTime = GUARD_DURATION;
				break;
			case "beam":
				this.beamTime = BEAM_DURATION;
				break;
			case "life":
				this.lives = Math.min(this.lives + 1, MAX_LIVES);
				this.updateHud();
				break;
		}
	}

	// ----- Beam -----
	fireBeam() {
		if (this.beamTime <= 0 || this.beamCooldown > 0) {
			return;
		}
		this.beamCooldown = BEAM_COOLDOWN;
		for (const emitter of this.beamEmitters) {
			const antibody = this.createAntibody();
			antibody.position.set(emitter.position.x, emitter.position.y + ANTIBODY_STEM_LENGTH, 0);
			antibody.rotation.y = Math.random() * Math.PI;
			this.scene.add(antibody);
			this.beams.push({ mesh: antibody });
		}
		this.sound.beam();
	}

	updateBeams(deltaTime) {
		this.beams = this.beams.filter((beam) => {
			const position = beam.mesh.position;
			position.y += BEAM_SPEED * deltaTime;
			beam.mesh.rotation.y += ANTIBODY_SPIN_SPEED * deltaTime;
			const tipY = position.y + ANTIBODY_TOP;
			const target = this.bricks.find(
				(brick) =>
					brick.alive &&
					Math.abs(position.x - brick.x) <= brick.halfSize + ANTIBODY_HALF_WIDTH * 0.5 &&
					tipY >= brick.y - brick.halfSize &&
					position.y <= brick.y + brick.halfSize,
			);
			if (target) {
				this.hitBrick(target);
			}
			const { boss } = this;
			const hitsBoss = !target && boss !== null && boss.hitPoints > 0 && Math.hypot(position.x - boss.position.x, tipY - boss.position.y) < BOSS_RADIUS;
			if (hitsBoss) {
				this.damageBoss();
			}
			if (target || hitsBoss || tipY > CEILING_Y) {
				this.spawnShards(new THREE.Vector3(position.x, Math.min(tipY, CEILING_Y), 0), new THREE.Color(ITEMS.beam.color), 6, 4);
				this.scene.remove(beam.mesh);
				return false;
			}
			return true;
		});
	}

	// ----- Effects -----
	spawnShards(origin, color, count, speed) {
		const shardColor = color.clone().multiplyScalar(1.6);
		for (let index = 0; index < count; index++) {
			const shardIndex = this.nextShardIndex;
			this.nextShardIndex = (this.nextShardIndex + 1) % SHARD_POOL_SIZE;
			const shard = this.shards[shardIndex];
			shard.maxLife = randomBetween(0.6, 1.3);
			shard.life = shard.maxLife;
			shard.position.copy(origin);
			shard.velocity
				.set(randomBetween(-1, 1), randomBetween(-1, 1), randomBetween(-0.2, 1))
				.normalize()
				.multiplyScalar(randomBetween(0.3, 1) * speed);
			shard.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
			shard.spin.set(randomBetween(-12, 12), randomBetween(-12, 12), randomBetween(-12, 12));
			shard.size = randomBetween(0.6, 1.6);
			this.shardMesh.setColorAt(shardIndex, shardColor);
		}
		this.shardMesh.instanceColor.needsUpdate = true;
	}

	updateShards(deltaTime) {
		for (let index = 0; index < SHARD_POOL_SIZE; index++) {
			const shard = this.shards[index];
			if (shard.life <= 0) {
				continue;
			}
			shard.life -= deltaTime;
			shard.velocity.y -= 6 * deltaTime;
			shard.velocity.multiplyScalar(Math.exp(-1.2 * deltaTime));
			shard.position.addScaledVector(shard.velocity, deltaTime);
			shard.rotation.x += shard.spin.x * deltaTime;
			shard.rotation.y += shard.spin.y * deltaTime;
			shard.rotation.z += shard.spin.z * deltaTime;
			this.dummy.position.copy(shard.position);
			this.dummy.rotation.copy(shard.rotation);
			this.dummy.scale.setScalar(Math.max(shard.life / shard.maxLife, 0) * shard.size);
			this.dummy.updateMatrix();
			this.shardMesh.setMatrixAt(index, this.dummy.matrix);
		}
		this.shardMesh.instanceMatrix.needsUpdate = true;
	}

	updateDust(deltaTime) {
		const time = performance.now() / 1000;
		const bottom = VIEW_BOTTOM_Y - 6;
		const top = VIEW_TOP_Y + 6;
		this.dust.forEach((particle, index) => {
			// Drifts against the travel direction like particles in a flow, and wraps around the camera.
			particle.position.x -= particle.speed * deltaTime;
			particle.position.y += particle.speed * 0.3 * deltaTime;
			if (particle.position.x < this.cameraX - DUST_HALF_RANGE_X) {
				particle.position.x += DUST_HALF_RANGE_X * 2;
			} else if (particle.position.x > this.cameraX + DUST_HALF_RANGE_X) {
				particle.position.x -= DUST_HALF_RANGE_X * 2;
			}
			if (particle.position.y > top) {
				particle.position.y = bottom;
			}
			this.dummy.position.set(particle.position.x, particle.position.y + Math.sin(time * 0.5 + particle.phase) * 0.3, particle.position.z);
			this.dummy.rotation.set(time + particle.phase, time * 0.7, 0);
			this.dummy.scale.setScalar(0.6 + Math.sin(time * 2 + particle.phase) * 0.4);
			this.dummy.updateMatrix();
			this.dustMesh.setMatrixAt(index, this.dummy.matrix);
		});
		this.dustMesh.instanceMatrix.needsUpdate = true;
	}

	updateBricks(deltaTime) {
		const time = performance.now() / 1000;
		const visibleReach = this.halfViewWidth + 3;
		for (const brick of this.bricks) {
			if (brick.kind === "redCell") {
				brick.y = brick.baseY + Math.sin(this.stageTime * RED_CELL_BOB_SPEED + brick.bobPhase) * RED_CELL_BOB_AMPLITUDE;
				brick.mesh.position.y = brick.y;
			}
			// Bricks far off screen keep their state; there's no need to animate them.
			if (Math.abs(brick.x - this.cameraX) > visibleReach && brick.popTime === 0) {
				continue;
			}
			const material = brick.mesh.material;
			if (brick.alive) {
				const appear = this.state === "intro" ? easeOutBack(clamp01((this.stateTime - brick.introDelay) / 0.45)) : 1;
				brick.mesh.scale.setScalar(Math.max(appear, 0.001));
				brick.mesh.position.z = Math.sin(time * 1.5 + brick.x * 0.6 + brick.baseY * 0.4) * 0.08;
				if (brick.kind === "redCell") {
					brick.mesh.rotation.y = Math.sin(time * 1.2 + brick.bobPhase) * 0.6;
				} else {
					brick.mesh.rotation.x = Math.sin(time + brick.x) * 0.05;
				}
				if (brick.icon) {
					brick.icon.rotation.z = Math.sin(time * 2 + brick.x) * 0.15;
				}
				const restingGlow = { tissue: 0.15, redCell: 0.35, ice: 0.2 }[brick.kind] ?? (brick.kind === "armored" && brick.hitPoints === brick.maxHitPoints ? 0.3 : 0.12);
				material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, restingGlow, 5, deltaTime);
			} else if (brick.popTime > 0) {
				brick.popTime += deltaTime;
				const progress = clamp01(brick.popTime / BRICK_POP_DURATION);
				brick.mesh.scale.setScalar(1 + progress * 0.8);
				material.opacity = brick.baseOpacity * (1 - progress);
				material.emissiveIntensity = 3 * (1 - progress);
				if (brick.edges) {
					brick.edges.material.opacity = 0.9 * (1 - progress);
				}
				if (brick.icon) {
					brick.icon.material.opacity = 1 - progress;
				}
				if (progress >= 1) {
					brick.popTime = 0;
					brick.mesh.visible = false;
				}
			}
		}
	}

	updateLevel(deltaTime) {
		const time = performance.now() / 1000;
		this.wallMaterial.emissiveIntensity = THREE.MathUtils.damp(this.wallMaterial.emissiveIntensity, 1.6, 6, deltaTime);
		this.startWallMaterial.emissiveIntensity = this.wallMaterial.emissiveIntensity;
		if (this.leftBoundX < 0 && this.startWall.visible) {
			this.startWallMaterial.opacity = Math.max(this.startWallMaterial.opacity - START_WALL_FADE_SPEED * deltaTime, 0);
			this.startWall.visible = this.startWallMaterial.opacity > 0;
		}
		this.gateRing.rotation.z = time * 0.8;
		this.gateRing.scale.setScalar(1 + Math.sin(time * 2) * 0.04);
		this.gateBeamMaterial.opacity = this.isGoalLocked ? 0.08 : 0.25 + Math.sin(time * 5) * 0.1;
		this.barrier.visible = this.boss !== null && this.barrierMaterial.opacity > 0.01;
	}

	updateBallVisuals(deltaTime) {
		const visible = this.state !== "over";
		const showTrail = visible && (this.state === "playing" || this.state === "intro");
		for (const ball of this.balls) {
			ball.group.visible = visible;
			ball.group.position.copy(ball.position);
			ball.photoSprite.material.rotation = ball.spin;
			ball.photoSprite.material.opacity = this.isGhost(ball) ? 0.35 + Math.sin(performance.now() / 80) * 0.15 : 1;
			ball.shell.rotation.set(ball.spin * 0.3, ball.spin, 0);
			ball.color.lerp(BASE_BALL_COLOR, 1 - Math.exp(-2 * deltaTime));
			ball.glow.material.color.copy(ball.color);

			ball.history.unshift(ball.position.clone());
			ball.history.length = Math.min(ball.history.length, (TRAIL_LENGTH + 1) * 2);
			ball.trail.forEach((mesh, index) => {
				// Skip the newest positions so the trail doesn't cover the photo inside the ball.
				const position = ball.history[(index + 1) * 2];
				mesh.visible = showTrail && position !== undefined;
				if (mesh.visible) {
					mesh.position.copy(position);
					mesh.scale.setScalar(1 - index / TRAIL_LENGTH);
					mesh.material.color.copy(ball.color);
				}
			});
		}

		const { leadBall } = this;
		if (leadBall) {
			this.ballLight.color.copy(leadBall.color);
			this.ballLight.position.set(leadBall.position.x, leadBall.position.y, 2.5);
		}
		this.ballLight.intensity = THREE.MathUtils.damp(this.ballLight.intensity, 25, 4, deltaTime);
	}

	updateCamera(deltaTime) {
		// The camera follows the lead ball while it is in play, and stays put otherwise
		// (so the paddle can't carry a resting ball forward).
		const { leadBall } = this;
		if (this.state === "playing" && leadBall) {
			const lead = THREE.MathUtils.clamp(leadBall.velocity.x / BALL_LAUNCH_SPEED, -1, 1) * CAMERA_LEAD;
			const targetX = this.clampCameraX(leadBall.position.x + lead);
			this.cameraX = THREE.MathUtils.damp(this.cameraX, targetX, CAMERA_FOLLOW_RATE, deltaTime);
		}
		this.keyLight.position.set(this.cameraX + 4, 6, 10);
		this.keyLight.target.position.set(this.cameraX, 0, 0);

		this.cameraShake = Math.min(this.cameraShake, 1) * Math.exp(-7 * deltaTime);
		const time = performance.now() / 1000;
		this.placeCamera(Math.sin(time * 0.3) * 0.3 + randomBetween(-1, 1) * this.cameraShake, randomBetween(-1, 1) * this.cameraShake);
	}

	// ----- Teardown -----
	close() {
		if (this.state === "closed") {
			return;
		}
		this.state = "closed";
		this.unbindEvents();
		this.sound.stopMusic();
		this.overlay.classList.remove("is-visible");
		this.photo.style.visibility = "";
		document.documentElement.style.overflow = this.previousOverflow ?? "";
		clearTimeout(this.toastTimer);

		setTimeout(() => {
			if (this.renderer) {
				this.renderer.setAnimationLoop(null);
				this.disposeScene();
				this.pipeline?.dispose();
				this.environmentTarget?.dispose();
				this.pmremGenerator?.dispose();
				this.renderer.dispose();
			}
			this.epilogueTexture?.dispose();
			for (const texture of [...(this.iconTextures?.values() ?? []), ...this.emojiTextures.values()]) {
				texture.dispose();
			}
			this.sound.dispose();
			this.overlay.remove();
			this.stylesheet.remove();
			this.resolveClosed();
		}, 500);
	}

	disposeScene() {
		// Shared resources may not be in the scene when nothing uses them right now.
		for (const resource of [
			this.antibodyStemGeometry,
			this.antibodyArmGeometry,
			this.antibodyTipGeometry,
			this.beamMaterial,
			this.antibodyTipMaterial,
			this.histamineGeometry,
			this.histamineMaterial,
			this.redCellGeometry,
			this.brickIconGeometry,
		]) {
			resource?.dispose();
		}
		this.scene?.traverse((object) => {
			object.geometry?.dispose();
			for (const material of [object.material].flat()) {
				material?.map?.dispose();
				material?.dispose();
			}
		});
	}
}

/**
 * Starts the hidden side-scrolling breakout game on top of the page.
 * Resolves when the player closes the game.
 *
 * @param {{ photo: HTMLImageElement, onStart?: () => void, onProgress?: (fraction: number) => void }} options
 */
export const startBreakout = async ({ photo, onStart = () => {}, onProgress = () => {} }) => {
	const game = new BreakoutGame(photo, onStart, onProgress);
	return game.start();
};

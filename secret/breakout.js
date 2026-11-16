/*! secret/breakout.js — a glassy 3D breakout hidden in profile.kcrt.net */
import * as THREE from "three/webgpu";
import { clamp, luminance, max, pass, renderOutput, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ICE_BRICK_ITEMS, ITEMS, ITEM_TYPES, STAGES } from "./stages.js";
import { SoundEngine } from "./sound.js";
import { loadIconTextures } from "./icon-textures.js";

// ---------- Tunables ----------
const FIELD_WIDTH = 12;
const FIELD_HEIGHT = 16;
const HALF_WIDTH = FIELD_WIDTH / 2;
const HALF_HEIGHT = FIELD_HEIGHT / 2;

const BALL_RADIUS = 0.5;
const BALL_SPEED = 9;
const BALL_MAX_SPEED = 15;
const BALL_SPEEDUP_ON_PADDLE = 1.02;
const MAX_BOUNCE_ANGLE = THREE.MathUtils.degToRad(60);
const MIN_VERTICAL_RATIO = 0.3;
const MAX_BALLS = 6;

const PADDLE_WIDTH = 2.6;
const PADDLE_HEIGHT = 0.36;
const PADDLE_Y = -HALF_HEIGHT + 1.2;
const PADDLE_KEYBOARD_SPEED = 16;

const BRICK_COLUMNS = 8;
const BRICK_ROW_HUES = [0.92, 0.02, 0.1, 0.17, 0.33, 0.5, 0.62];
const BRICK_GAP = 0.14;
const BRICK_HEIGHT = 0.62;
const BRICK_DEPTH = 0.62;
const BRICK_TOP_Y = HALF_HEIGHT - 1.2;
const BRICK_FIELD_PADDING = 0.3;

const ITEM_RADIUS = 0.42;
const ITEM_FALL_SPEED = 3.2;
const RANDOM_DROP_CHANCE = 0.08;
const WIDE_DURATION = 12;
const WIDE_FACTOR = 1.6;
const GUARD_DURATION = 15;
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
const INITIAL_LIVES = 3;
const MAX_LIVES = 5;

const BASE_BALL_COLOR = new THREE.Color(0x88ccff);
const TRAIL_LENGTH = 18;
const SHARD_POOL_SIZE = 700;
const SHARDS_PER_BRICK = 16;
const DUST_COUNT = 140;

const CAMERA_FOV = 42;
const INTRO_DURATION = 1.1;
const BRICK_POP_DURATION = 0.18;
const TOAST_DURATION_MS = 1400;

const STYLESHEET_URL = new URL("./breakout.css", import.meta.url).href;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

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

/** Draws the profile photo into a circular texture used inside the glass ball. */
const createPhotoTexture = (image) => {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	context.beginPath();
	context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
	context.clip();
	context.drawImage(image, 0, 0, size, size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
};

/** Soft radial glow used around balls and items. */
const createGlowTexture = () => {
	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	gradient.addColorStop(0, "rgba(255,255,255,1)");
	gradient.addColorStop(0.35, "rgba(255,255,255,.35)");
	gradient.addColorStop(1, "rgba(255,255,255,0)");
	context.fillStyle = gradient;
	context.fillRect(0, 0, size, size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
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

		this.paddleX = 0;
		this.paddleTargetX = 0;
		this.paddleWidth = PADDLE_WIDTH;
		this.keysHeld = new Set();

		this.ballSpeed = BALL_SPEED;
		this.balls = [];
		this.ballIntroFrom = new THREE.Vector3();

		this.wideTime = 0;
		this.guardTime = 0;
		this.beamTime = 0;
		this.beamCooldown = 0;
		this.beams = [];
		this.items = [];

		this.cameraShake = 0;
		this.cameraBasePosition = new THREE.Vector3();
		this.cameraLookAt = new THREE.Vector3(0, -0.4, 0);

		this.bricks = [];
		this.shards = [];
		this.dust = [];

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
		await this.renderer.compileAsync(this.scene, this.camera);
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
		this.comboLabel = document.createElement("span");
		this.comboLabel.className = "secret-combo";
		this.effectsLabel = document.createElement("span");
		this.effectsLabel.className = "secret-effects";
		this.hud.append(this.scoreLabel, this.livesLabel, this.stageLabel, this.comboLabel, this.effectsLabel);

		this.closeButton = document.createElement("button");
		this.closeButton.type = "button";
		this.closeButton.className = "secret-button secret-close";
		this.closeButton.setAttribute("aria-label", "Close");
		this.closeButton.textContent = "✕";

		this.muteButton = document.createElement("button");
		this.muteButton.type = "button";
		this.muteButton.className = "secret-button secret-mute";
		this.updateMuteButton();

		this.messageBox = document.createElement("div");
		this.messageBox.className = "secret-message";

		this.toast = document.createElement("div");
		this.toast.className = "secret-toast";

		this.overlay.append(this.hud, this.muteButton, this.closeButton, this.messageBox, this.toast);
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
		const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
		keyLight.position.set(4, 6, 10);
		this.scene.add(keyLight);
		this.ballLight = new THREE.PointLight(BASE_BALL_COLOR, 25, 14, 2);
		this.ballLight.position.z = 2.5;
		this.scene.add(this.ballLight);

		this.photoTexture = createPhotoTexture(this.photo);
		this.glowTexture = createGlowTexture();
		this.ballShellGeometry = new THREE.SphereGeometry(BALL_RADIUS, 48, 32);
		this.trailGeometry = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
		this.itemShellGeometry = new THREE.SphereGeometry(ITEM_RADIUS, 32, 24);

		const usableWidth = FIELD_WIDTH - BRICK_FIELD_PADDING * 2;
		this.brickWidth = (usableWidth - (BRICK_COLUMNS - 1) * BRICK_GAP) / BRICK_COLUMNS;
		this.brickGeometry = new THREE.BoxGeometry(this.brickWidth, BRICK_HEIGHT, BRICK_DEPTH);
		this.brickEdgesGeometry = new THREE.EdgesGeometry(this.brickGeometry);
		this.brickIconGeometry = new THREE.PlaneGeometry(BRICK_HEIGHT * 1.2, BRICK_HEIGHT * 1.2);

		this.createFrame();
		this.createPaddle();
		this.createGuard();
		this.createBeams();
		this.createShards();
		this.createDust();
		this.createPipeline();
	}

	createFrame() {
		this.wallMaterial = new THREE.MeshStandardMaterial({
			color: 0x111122,
			emissive: 0x66ccff,
			emissiveIntensity: 1.6,
			transparent: true,
			opacity: 0.9,
		});
		const sideGeometry = new THREE.BoxGeometry(0.12, FIELD_HEIGHT + 0.24, 0.12);
		const topGeometry = new THREE.BoxGeometry(FIELD_WIDTH + 0.24, 0.12, 0.12);
		const leftWall = new THREE.Mesh(sideGeometry, this.wallMaterial);
		leftWall.position.set(-HALF_WIDTH - 0.06, 0, 0);
		const rightWall = new THREE.Mesh(sideGeometry, this.wallMaterial);
		rightWall.position.set(HALF_WIDTH + 0.06, 0, 0);
		const topWall = new THREE.Mesh(topGeometry, this.wallMaterial);
		topWall.position.set(0, HALF_HEIGHT + 0.06, 0);

		const backPanel = new THREE.Mesh(
			new THREE.PlaneGeometry(FIELD_WIDTH, FIELD_HEIGHT),
			new THREE.MeshBasicMaterial({ color: 0x16244d, transparent: true, opacity: 0.35, depthWrite: false }),
		);
		backPanel.position.z = -0.9;

		const grid = new THREE.GridHelper(FIELD_HEIGHT, 16, 0x88aaff, 0x5577cc);
		grid.rotation.x = Math.PI / 2;
		grid.scale.x = FIELD_WIDTH / FIELD_HEIGHT;
		grid.position.z = -0.88;
		for (const material of [grid.material].flat()) {
			material.transparent = true;
			material.opacity = 0.18;
			material.depthWrite = false;
		}

		this.scene.add(leftWall, rightWall, topWall, backPanel, grid);
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
		this.paddle.position.set(0, PADDLE_Y, 0);
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
		this.guard = new THREE.Mesh(new THREE.BoxGeometry(FIELD_WIDTH, 0.14, 0.3), this.guardMaterial);
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

	/** (Re)creates the bricks of the current stage. */
	buildStage() {
		for (const brick of this.bricks) {
			this.scene.remove(brick.mesh);
			brick.mesh.material.dispose();
			brick.edges.material.dispose();
			brick.icon?.material.dispose();
		}
		this.bricks = [];

		const usableWidth = FIELD_WIDTH - BRICK_FIELD_PADDING * 2;
		this.stage.layout.forEach((rowLayout, row) => {
			const hue = BRICK_ROW_HUES[row % BRICK_ROW_HUES.length];
			[...rowLayout].forEach((cell, column) => {
				if (cell === ".") {
					return;
				}
				const x = -usableWidth / 2 + this.brickWidth / 2 + column * (this.brickWidth + BRICK_GAP);
				const y = BRICK_TOP_Y - row * (BRICK_HEIGHT + BRICK_GAP);
				const item = cell === "?" ? randomItem() : ICE_BRICK_ITEMS[cell];
				const kind = item ? "ice" : cell === "a" ? "armored" : cell === "s" ? "steel" : "normal";
				this.bricks.push(this.createBrick({ kind, item, hue, x, y, row, column }));
			});
		});
	}

	createBrick({ kind, item, hue, x, y, row, column }) {
		let color;
		let material;
		switch (kind) {
			case "steel":
				color = new THREE.Color(0x4a5263);
				material = new THREE.MeshPhysicalMaterial({ color, metalness: 0.85, roughness: 0.4 });
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
					emissiveIntensity: isArmored ? 0.5 : 0.35,
					transparent: true,
					opacity: isArmored ? 0.75 : 0.5,
					roughness: 0.15,
					iridescence: 0.5,
					iridescenceIOR: 1.4,
				});
			}
		}

		const mesh = new THREE.Mesh(this.brickGeometry, material);
		mesh.position.set(x, y, 0);
		mesh.renderOrder = 2;
		const edges = new THREE.LineSegments(
			this.brickEdgesGeometry,
			new THREE.LineBasicMaterial({
				color: kind === "steel" ? new THREE.Color(0xffffff) : color.clone().multiplyScalar(2.5),
				transparent: true,
				opacity: kind === "steel" ? 0.5 : 0.9,
			}),
		);
		mesh.add(edges);

		let icon = null;
		if (item) {
			icon = new THREE.Mesh(
				this.brickIconGeometry,
				new THREE.MeshBasicMaterial({
					map: this.iconTextures.get(ITEMS[item].icon),
					color: new THREE.Color(ITEMS[item].color).multiplyScalar(1.3),
					transparent: true,
					depthWrite: false,
				}),
			);
			// Drawn after the (non depth-writing) ice so the frosty surface doesn't wash it out.
			icon.position.z = BRICK_DEPTH * 0.1;
			icon.renderOrder = 3;
			mesh.add(icon);
		}
		this.scene.add(mesh);

		const motion = this.stage.movingRows?.[row];
		const maxHitPoints = kind === "armored" ? 2 : 1;
		return {
			mesh,
			edges,
			icon,
			kind,
			item,
			color,
			baseX: x,
			x,
			y,
			motion,
			halfWidth: this.brickWidth / 2,
			halfHeight: BRICK_HEIGHT / 2,
			maxHitPoints,
			hitPoints: maxHitPoints,
			baseOpacity: material.opacity,
			introDelay: (row * BRICK_COLUMNS + column) * 0.012 + row * 0.04,
			alive: true,
			popTime: 0,
		};
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
			new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
			DUST_COUNT,
		);
		this.dustMesh.frustumCulled = false;
		for (let index = 0; index < DUST_COUNT; index++) {
			this.dust.push({
				position: new THREE.Vector3(randomBetween(-14, 14), randomBetween(-12, 12), randomBetween(-10, -1.5)),
				speed: randomBetween(0.2, 0.8),
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

		const ball = { position: position.clone(), velocity: velocity.clone(), spin: 0, color, group, photoSprite, shell, glow, trail, history: [] };
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

	/** Keeps the ball from travelling (almost) horizontally forever. */
	normalizeVelocity(velocity) {
		velocity.setLength(this.ballSpeed);
		const minVertical = this.ballSpeed * MIN_VERTICAL_RATIO;
		if (Math.abs(velocity.y) < minVertical) {
			velocity.y = (velocity.y >= 0 ? 1 : -1) * minVertical;
			velocity.setLength(this.ballSpeed);
		}
	}

	// ----- Input -----
	bindEvents() {
		this.handlePointerMove = (event) => {
			this.paddleTargetX = this.screenToField(event.clientX, event.clientY).x;
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
			} else if (event.key === " " || event.key === "Enter") {
				event.preventDefault();
				this.handleAction();
			} else if (event.key === "m" || event.key === "M") {
				this.toggleMute();
			} else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				event.preventDefault();
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

		const canvas = this.renderer.domElement;
		canvas.addEventListener("pointermove", this.handlePointerMove);
		canvas.addEventListener("pointerdown", this.handlePointerDown);
		window.addEventListener("keydown", this.handleKeyDown);
		window.addEventListener("keyup", this.handleKeyUp);
		window.addEventListener("resize", this.handleResize);
		this.closeButton.addEventListener("click", this.handleClose);
		this.muteButton.addEventListener("click", this.handleMute);
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
	}

	handleAction() {
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

	// ----- Camera -----
	fitCamera() {
		const aspect = window.innerWidth / window.innerHeight;
		const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
		const distance = Math.max((HALF_HEIGHT + 1.4) / tanHalfFov, (HALF_WIDTH + 1) / (tanHalfFov * aspect));
		this.camera.aspect = aspect;
		this.camera.updateProjectionMatrix();
		this.cameraBasePosition.set(0, -distance * 0.2, distance);
		this.camera.position.copy(this.cameraBasePosition);
		this.camera.lookAt(this.cameraLookAt);
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
		this.resetBalls();
		this.ballSpeed = BALL_SPEED;
		this.stageTime = 0;
		this.sound.startMusic(this.stage);
		this.setState("intro");
		this.showToast(this.stage.name);
	}

	clearEffects() {
		this.wideTime = 0;
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
	}

	setState(state) {
		this.state = state;
		this.stateTime = 0;
		switch (state) {
			case "intro":
				this.combo = 0;
				this.setMessage("");
				break;
			case "ready":
				this.setMessage(matchMedia("(pointer: coarse)").matches ? "Tap to launch" : "Click / Space to launch\nEsc to exit · M to mute");
				break;
			case "playing":
				this.setMessage("");
				break;
			case "stageClear":
				this.setMessage(`${this.stage.name} CLEAR! ✨\nTime ${formatNanoseconds(this.lastClearTime)}\nClick for ${STAGES[this.stageIndex + 1].name}`);
				break;
			case "complete":
				this.setMessage(
					`ALL CLEAR! 🎉\nTime ${formatNanoseconds(this.lastClearTime)}\nTotal ${formatNanoseconds(this.totalClearTime)}\nScore ${this.score.toLocaleString()}\nClick to play again · Esc to exit`,
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
	}

	updateEffectsLabel() {
		const effects = [
			[this.wideTime, ITEMS.wide.label],
			[this.guardTime, ITEMS.guard.label],
			[this.beamTime, ITEMS.beam.label],
		]
			.filter(([time]) => time > 0)
			.map(([time, label]) => `${label} ${Math.ceil(time)}`);
		const text = effects.join(" · ");
		if (this.effectsLabel.textContent !== text) {
			this.effectsLabel.textContent = text;
		}
	}

	launchBall() {
		const [ball] = this.balls;
		const angle = randomBetween(-0.35, 0.35);
		ball.velocity.set(Math.sin(angle), Math.cos(angle), 0).multiplyScalar(this.ballSpeed);
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
		this.stateTime += deltaTime;
		this.stageTime += deltaTime;

		this.updateEffects(deltaTime);
		this.updatePaddle(deltaTime);
		this.updateBallState(deltaTime);
		this.updateBeams(deltaTime);
		this.updateItems(deltaTime);
		this.updateBricks(deltaTime);
		this.updateShards(deltaTime);
		this.updateDust(deltaTime);
		this.updateBallVisuals(deltaTime);
		this.updateCamera(deltaTime);

		this.pipeline.render();
	}

	updateEffects(deltaTime) {
		if (this.state === "playing") {
			this.wideTime = Math.max(this.wideTime - deltaTime, 0);
			this.guardTime = Math.max(this.guardTime - deltaTime, 0);
			this.beamTime = Math.max(this.beamTime - deltaTime, 0);
		}
		this.beamCooldown = Math.max(this.beamCooldown - deltaTime, 0);

		const guardBlink = this.guardTime > 0 && this.guardTime < 3 && Math.floor(this.guardTime * 8) % 2 === 0;
		this.guard.visible = this.guardTime > 0 && !guardBlink;
		this.guardMaterial.emissiveIntensity = THREE.MathUtils.damp(this.guardMaterial.emissiveIntensity, 2, 6, deltaTime);
		this.updateEffectsLabel();
	}

	updatePaddle(deltaTime) {
		if (this.keysHeld.has("ArrowLeft")) {
			this.paddleTargetX -= PADDLE_KEYBOARD_SPEED * deltaTime;
		}
		if (this.keysHeld.has("ArrowRight")) {
			this.paddleTargetX += PADDLE_KEYBOARD_SPEED * deltaTime;
		}
		this.paddleWidth = THREE.MathUtils.damp(this.paddleWidth, this.wideTime > 0 ? PADDLE_WIDTH * WIDE_FACTOR : PADDLE_WIDTH, 8, deltaTime);
		const limit = HALF_WIDTH - this.paddleWidth / 2;
		this.paddleTargetX = THREE.MathUtils.clamp(this.paddleTargetX, -limit, limit);
		const previousX = this.paddleX;
		this.paddleX = THREE.MathUtils.damp(this.paddleX, this.paddleTargetX, 20, deltaTime);
		this.paddle.position.x = this.paddleX;
		this.paddle.scale.x = this.paddleWidth / PADDLE_WIDTH;
		this.paddle.rotation.y = THREE.MathUtils.clamp(((this.paddleX - previousX) / Math.max(deltaTime, 1e-3)) * 0.03, -0.5, 0.5);
		this.paddleMaterial.emissiveIntensity = THREE.MathUtils.damp(this.paddleMaterial.emissiveIntensity, 0.8, 6, deltaTime);

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
				if (this.balls.length === 0) {
					this.loseLife();
				}
				break;
			default:
				break;
		}
	}

	stepBall(ball, deltaTime) {
		const steps = Math.max(1, Math.ceil((this.ballSpeed * deltaTime) / (BALL_RADIUS * 0.5)));
		const stepTime = deltaTime / steps;
		for (let step = 0; step < steps && this.state === "playing"; step++) {
			ball.position.addScaledVector(ball.velocity, stepTime);
			this.collideWithWalls(ball);
			this.collideWithGuard(ball);
			this.collideWithPaddle(ball);
			this.collideWithBricks(ball);
			if (ball.position.y < -HALF_HEIGHT - 1.5) {
				this.spawnShards(ball.position, new THREE.Color(0xff5577), 20, 8);
				this.removeBall(ball);
				if (this.balls.length > 0) {
					this.sound.wall();
				}
				return;
			}
		}
		ball.spin += (ball.velocity.x >= 0 ? -1 : 1) * this.ballSpeed * deltaTime * 0.6;
	}

	collideWithWalls(ball) {
		const { position, velocity } = ball;
		let hit = false;
		if (position.x - BALL_RADIUS < -HALF_WIDTH) {
			position.x = -HALF_WIDTH + BALL_RADIUS;
			velocity.x = Math.abs(velocity.x);
			hit = true;
		} else if (position.x + BALL_RADIUS > HALF_WIDTH) {
			position.x = HALF_WIDTH - BALL_RADIUS;
			velocity.x = -Math.abs(velocity.x);
			hit = true;
		}
		if (position.y + BALL_RADIUS > HALF_HEIGHT) {
			position.y = HALF_HEIGHT - BALL_RADIUS;
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
		velocity.y = Math.abs(velocity.y);
		this.normalizeVelocity(velocity);
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
		const reach = this.paddleWidth / 2 + BALL_RADIUS;
		const offsetX = position.x - this.paddleX;
		if (position.y - BALL_RADIUS > paddleTop || position.y < PADDLE_Y - PADDLE_HEIGHT || Math.abs(offsetX) > reach) {
			return;
		}
		const angle = THREE.MathUtils.clamp(offsetX / reach, -1, 1) * MAX_BOUNCE_ANGLE;
		this.ballSpeed = Math.min(this.ballSpeed * BALL_SPEEDUP_ON_PADDLE, BALL_MAX_SPEED);
		velocity.set(Math.sin(angle), Math.cos(angle), 0).multiplyScalar(this.ballSpeed);
		position.y = paddleTop + BALL_RADIUS;
		this.combo = 0;
		this.paddleMaterial.emissiveIntensity = 3;
		this.cameraShake += 0.05;
		this.sound.paddle();
		this.updateHud();
	}

	collideWithBricks(ball) {
		const { position, velocity } = ball;
		for (const brick of this.bricks) {
			if (!brick.alive) {
				continue;
			}
			const closestX = THREE.MathUtils.clamp(position.x, brick.x - brick.halfWidth, brick.x + brick.halfWidth);
			const closestY = THREE.MathUtils.clamp(position.y, brick.y - brick.halfHeight, brick.y + brick.halfHeight);
			const distanceX = position.x - closestX;
			const distanceY = position.y - closestY;
			if (distanceX * distanceX + distanceY * distanceY > BALL_RADIUS * BALL_RADIUS) {
				continue;
			}
			const directionX = position.x >= brick.x ? 1 : -1;
			const directionY = position.y >= brick.y ? 1 : -1;
			const overlapX = brick.halfWidth + BALL_RADIUS - Math.abs(position.x - brick.x);
			const overlapY = brick.halfHeight + BALL_RADIUS - Math.abs(position.y - brick.y);
			if (overlapX < overlapY) {
				velocity.x = directionX * Math.abs(velocity.x);
				position.x += directionX * overlapX;
			} else {
				velocity.y = directionY * Math.abs(velocity.y);
				position.y += directionY * overlapY;
			}
			this.normalizeVelocity(velocity);
			this.hitBrick(brick, ball.color);
			return;
		}
	}

	/**
	 * @param {object} brick
	 * @param {THREE.Color} [ballColor] - tinted with the brick color when a ball hits it
	 */
	hitBrick(brick, ballColor) {
		if (brick.kind === "steel") {
			brick.mesh.material.emissive = new THREE.Color(0xffffff);
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
			if (this.bricks.every((candidate) => !candidate.alive || candidate.kind === "steel")) {
				this.clearStage();
			}
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
			const origin = new THREE.Vector3(randomBetween(-HALF_WIDTH, HALF_WIDTH), randomBetween(0, HALF_HEIGHT), randomBetween(-1, 2));
			this.spawnShards(origin, palette[burst % palette.length], 40, 11);
		}
		this.cameraShake += 0.6;
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
			if (y < -HALF_HEIGHT - 1) {
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
						this.normalizeVelocity(velocity);
						this.createBall(ball.position, velocity);
					}
				}
				break;
			case "wide":
				this.wideTime = WIDE_DURATION;
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
					Math.abs(position.x - brick.x) <= brick.halfWidth + ANTIBODY_HALF_WIDTH * 0.5 &&
					tipY >= brick.y - brick.halfHeight &&
					position.y <= brick.y + brick.halfHeight,
			);
			if (target) {
				this.hitBrick(target);
			}
			if (target || tipY > HALF_HEIGHT) {
				this.spawnShards(new THREE.Vector3(position.x, Math.min(tipY, HALF_HEIGHT), 0), new THREE.Color(ITEMS.beam.color), 6, 4);
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
		this.dust.forEach((particle, index) => {
			particle.position.y += particle.speed * deltaTime;
			if (particle.position.y > 12) {
				particle.position.y = -12;
			}
			this.dummy.position.set(particle.position.x + Math.sin(time * 0.5 + particle.phase) * 0.3, particle.position.y, particle.position.z);
			this.dummy.rotation.set(time + particle.phase, time * 0.7, 0);
			this.dummy.scale.setScalar(0.6 + Math.sin(time * 2 + particle.phase) * 0.4);
			this.dummy.updateMatrix();
			this.dustMesh.setMatrixAt(index, this.dummy.matrix);
		});
		this.dustMesh.instanceMatrix.needsUpdate = true;
	}

	updateBricks(deltaTime) {
		const time = performance.now() / 1000;
		for (const brick of this.bricks) {
			const material = brick.mesh.material;
			if (brick.motion) {
				brick.x = brick.baseX + Math.sin(this.stageTime * brick.motion.speed) * brick.motion.amplitude;
				brick.mesh.position.x = brick.x;
			}
			if (brick.alive) {
				const appear = this.state === "intro" ? easeOutBack(clamp01((this.stateTime - brick.introDelay) / 0.45)) : 1;
				brick.mesh.scale.setScalar(Math.max(appear, 0.001));
				brick.mesh.position.z = Math.sin(time * 1.5 + brick.baseX * 0.6 + brick.y * 0.4) * 0.08;
				brick.mesh.rotation.x = Math.sin(time + brick.baseX) * 0.05;
				if (brick.icon) {
					brick.icon.rotation.z = Math.sin(time * 2 + brick.baseX) * 0.15;
				}
				const restingGlow = brick.kind === "steel" ? 0 : brick.kind === "ice" ? 0.2 : brick.kind === "armored" && brick.hitPoints === brick.maxHitPoints ? 0.5 : 0.35;
				material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, restingGlow, 5, deltaTime);
			} else if (brick.popTime > 0) {
				brick.popTime += deltaTime;
				const progress = clamp01(brick.popTime / BRICK_POP_DURATION);
				brick.mesh.scale.setScalar(1 + progress * 0.8);
				material.opacity = brick.baseOpacity * (1 - progress);
				material.emissiveIntensity = 3 * (1 - progress);
				brick.edges.material.opacity = 0.9 * (1 - progress);
				if (brick.icon) {
					brick.icon.material.opacity = 1 - progress;
				}
				if (progress >= 1) {
					brick.popTime = 0;
					brick.mesh.visible = false;
				}
			}
		}
		this.wallMaterial.emissiveIntensity = THREE.MathUtils.damp(this.wallMaterial.emissiveIntensity, 1.6, 6, deltaTime);
	}

	updateBallVisuals(deltaTime) {
		const visible = this.state !== "over";
		const showTrail = visible && (this.state === "playing" || this.state === "intro");
		for (const ball of this.balls) {
			ball.group.visible = visible;
			ball.group.position.copy(ball.position);
			ball.photoSprite.material.rotation = ball.spin;
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

		const [leadBall] = this.balls;
		if (leadBall) {
			this.ballLight.color.copy(leadBall.color);
			this.ballLight.position.set(leadBall.position.x, leadBall.position.y, 2.5);
		}
		this.ballLight.intensity = THREE.MathUtils.damp(this.ballLight.intensity, 25, 4, deltaTime);
	}

	updateCamera(deltaTime) {
		this.cameraShake = Math.min(this.cameraShake, 1) * Math.exp(-7 * deltaTime);
		const time = performance.now() / 1000;
		this.camera.position.set(
			this.cameraBasePosition.x + Math.sin(time * 0.3) * 0.6 + randomBetween(-1, 1) * this.cameraShake,
			this.cameraBasePosition.y + randomBetween(-1, 1) * this.cameraShake,
			this.cameraBasePosition.z,
		);
		this.camera.lookAt(this.cameraLookAt);
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
			for (const texture of this.iconTextures?.values() ?? []) {
				texture.dispose();
			}
			this.sound.dispose();
			this.overlay.remove();
			this.stylesheet.remove();
			this.resolveClosed();
		}, 500);
	}

	disposeScene() {
		// Shared antibody resources may not be in the scene when no beam is flying.
		for (const resource of [this.antibodyStemGeometry, this.antibodyArmGeometry, this.antibodyTipGeometry, this.beamMaterial, this.antibodyTipMaterial]) {
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
 * Starts the hidden breakout game on top of the page.
 * Resolves when the player closes the game.
 *
 * @param {{ photo: HTMLImageElement, onStart?: () => void, onProgress?: (fraction: number) => void }} options
 */
export const startBreakout = async ({ photo, onStart = () => {}, onProgress = () => {} }) => {
	const game = new BreakoutGame(photo, onStart, onProgress);
	return game.start();
};

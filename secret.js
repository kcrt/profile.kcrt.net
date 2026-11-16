/*! secret.js — hidden mode for profile.kcrt.net */
"use strict";

// Clicking the profile photo 10 times in a row (with less than 2 seconds between clicks)
// loads and starts the hidden side-scrolling breakout game. The photo grows with every click, then glows
// while a loading bar shows the download / startup progress.
// As a hint, the photo gives a little heartbeat every 10–30 seconds.
(() => {
	const REQUIRED_CLICKS = 10;
	const RESET_DELAY_MS = 2000;
	const MAX_EXTRA_SCALE = 2.7;
	const CHARGED_SCALE = 4.4;

	// Fetched up front (with progress) so the dynamic import below hits the HTTP cache.
	// Sizes are the uncompressed byte counts: servers such as GitHub Pages send compressed
	// Content-Length values, which can't be compared with the decompressed bytes we receive.
	// Update them when secret/three/ is re-vendored (the game files are rough estimates).
	const GAME_FILES = [
		{ url: "./secret/breakout.js", bytes: 81000 },
		{ url: "./secret/breakout.css", bytes: 3000 },
		{ url: "./secret/stages.js", bytes: 7000 },
		{ url: "./secret/sound.js", bytes: 10000 },
		{ url: "./secret/icon-textures.js", bytes: 2200 },
		{ url: "./secret/gamepad.js", bytes: 2000 },
		{ url: "./secret/three/build/three.webgpu.js", bytes: 1350894 },
		{ url: "./secret/three/build/three.core.js", bytes: 1474799 },
		{ url: "./secret/three/build/three.tsl.js", bytes: 1065544 },
		{ url: "./secret/three/addons/tsl/display/BloomNode.js", bytes: 17230 },
		{ url: "./secret/three/addons/environments/RoomEnvironment.js", bytes: 4960 },
	];
	const DOWNLOAD_SHARE = 0.75;
	const IMPORT_SHARE = 0.05;
	const HEARTBEAT_MIN_DELAY_MS = 10000;
	const HEARTBEAT_MAX_DELAY_MS = 30000;

	const photo = document.querySelector("img.photo");
	if (!(photo instanceof HTMLImageElement)) {
		return;
	}

	let clickCount = 0;
	let resetTimer = undefined;
	let isRunning = false;

	const scaleForClicks = (count) => 1 + Math.pow(Math.min(count, REQUIRED_CLICKS - 1) / (REQUIRED_CLICKS - 1), 2) * MAX_EXTRA_SCALE;

	const setClickCount = (count) => {
		clickCount = count;
		photo.style.transform = count > 0 ? `scale(${scaleForClicks(count)})` : "";
	};

	const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

	const createLoader = () => {
		const element = document.createElement("div");
		element.className = "secret-loader";
		element.setAttribute("role", "progressbar");
		element.setAttribute("aria-valuemin", "0");
		element.setAttribute("aria-valuemax", "100");
		const track = document.createElement("div");
		track.className = "secret-loader-track";
		const fill = document.createElement("div");
		fill.className = "secret-loader-fill";
		const label = document.createElement("div");
		label.className = "secret-loader-label";
		track.append(fill);
		element.append(track, label);
		document.body.append(element);
		requestAnimationFrame(() => element.classList.add("is-visible"));

		let shownFraction = 0;
		return {
			setProgress(fraction, text) {
				shownFraction = Math.max(shownFraction, Math.min(fraction, 1));
				const percent = Math.round(shownFraction * 100);
				fill.style.transform = `scaleX(${shownFraction})`;
				label.textContent = `${text} ${percent}%`;
				element.setAttribute("aria-valuenow", String(percent));
			},
			remove() {
				element.classList.remove("is-visible");
				setTimeout(() => element.remove(), 400);
			},
		};
	};

	/** Downloads all files in parallel and reports the combined progress (0–1). */
	const prefetch = async (files, onProgress) => {
		const expectedTotal = files.reduce((total, file) => total + file.bytes, 0);
		const receivedBytes = new Map();
		const report = () => {
			const received = [...receivedBytes.values()].reduce((total, value) => total + value, 0);
			onProgress(received / Math.max(expectedTotal, received));
		};

		await Promise.all(
			files.map(async ({ url }) => {
				const response = await fetch(url);
				if (!response.ok || response.body === null) {
					throw new Error(`Failed to load ${url} (${response.status})`);
				}
				const reader = response.body.getReader();
				let received = 0;
				for (;;) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					received += value.byteLength;
					receivedBytes.set(url, received);
					report();
				}
			}),
		);
	};

	const launchGame = async () => {
		isRunning = true;
		// The enlarged photo must not cause horizontal scrolling on narrow screens.
		const previousOverflowX = document.documentElement.style.overflowX;
		document.documentElement.style.overflowX = "hidden";
		photo.classList.add("secret-charging");
		photo.style.transform = `scale(${CHARGED_SCALE})`;
		const loader = createLoader();
		loader.setProgress(0, "Loading");

		try {
			await prefetch(GAME_FILES, (fraction) => loader.setProgress(fraction * DOWNLOAD_SHARE, "Loading"));
			loader.setProgress(DOWNLOAD_SHARE, "Starting");
			await nextFrame();
			const { startBreakout } = await import("./secret/breakout.js");
			loader.setProgress(DOWNLOAD_SHARE + IMPORT_SHARE, "Starting");
			await nextFrame();
			await startBreakout({
				photo,
				onProgress: (fraction) => loader.setProgress(DOWNLOAD_SHARE + IMPORT_SHARE + fraction * (1 - DOWNLOAD_SHARE - IMPORT_SHARE), "Starting"),
				onStart: () => {
					loader.remove();
					photo.classList.remove("secret-charging");
					setClickCount(0);
				},
			});
		} catch (error) {
			console.error("Failed to start the hidden mode:", error);
		} finally {
			loader.remove();
			photo.classList.remove("secret-charging");
			setClickCount(0);
			document.documentElement.style.overflowX = previousOverflowX;
			isRunning = false;
		}
	};

	const scheduleHeartbeat = () => {
		const delay = HEARTBEAT_MIN_DELAY_MS + Math.random() * (HEARTBEAT_MAX_DELAY_MS - HEARTBEAT_MIN_DELAY_MS);
		setTimeout(() => {
			const isIdle = !isRunning && clickCount === 0 && !document.hidden;
			if (isIdle && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
				photo.classList.add("secret-heartbeat");
			}
			scheduleHeartbeat();
		}, delay);
	};
	photo.addEventListener("animationend", (event) => {
		if (event.animationName === "secret-heartbeat") {
			photo.classList.remove("secret-heartbeat");
		}
	});
	scheduleHeartbeat();

	photo.addEventListener("click", () => {
		if (isRunning) {
			return;
		}
		clearTimeout(resetTimer);
		photo.classList.remove("secret-heartbeat");
		setClickCount(clickCount + 1);
		if (clickCount >= REQUIRED_CLICKS) {
			launchGame();
			return;
		}
		resetTimer = setTimeout(() => setClickCount(0), RESET_DELAY_MS);
	});
})();

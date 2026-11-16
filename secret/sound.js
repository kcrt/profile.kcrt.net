/*! secret/sound.js — synthesized sound effects and music for the hidden side-scrolling breakout */

const MUTE_STORAGE_KEY = "kcrt-secret-muted";
const MASTER_VOLUME = 0.5;
const MUSIC_VOLUME = 0.16;
const SCHEDULE_AHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;

// Minor pentatonic scale degrees (semitones from the root).
const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
// Chord roots (semitones from the stage root) for the 4-bar progression: i - VI - III - VII
const PROGRESSION = [0, -4, 3, -2];
const ARPEGGIO_PATTERN = [0, 2, 4, 2, 5, 4, 2, 4];

const midiToFrequency = (note) => 440 * Math.pow(2, (note - 69) / 12);
const clampIndex = (value, min, max) => Math.min(Math.max(value, min), max);

const readMuted = () => {
	try {
		return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
};

const writeMuted = (muted) => {
	try {
		localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
	} catch {
		// Storage may be unavailable (private mode etc.); the setting just won't persist.
	}
};

export class SoundEngine {
	constructor() {
		this.context = new AudioContext();
		this.muted = readMuted();

		this.compressor = this.context.createDynamicsCompressor();
		this.compressor.connect(this.context.destination);
		this.master = this.context.createGain();
		this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
		this.master.connect(this.compressor);
		this.effectsBus = this.context.createGain();
		this.effectsBus.connect(this.master);
		this.musicBus = this.context.createGain();
		this.musicBus.gain.value = MUSIC_VOLUME;
		this.musicBus.connect(this.master);

		this.noiseBuffer = this.createNoiseBuffer();
		this.musicTimer = undefined;
	}

	createNoiseBuffer() {
		const length = this.context.sampleRate;
		const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
		const data = buffer.getChannelData(0);
		for (let index = 0; index < length; index++) {
			data[index] = Math.random() * 2 - 1;
		}
		return buffer;
	}

	/** Browsers start audio suspended until a user gesture; call this from input handlers. */
	resume() {
		if (this.context.state === "suspended") {
			this.context.resume().catch(() => {});
		}
	}

	toggleMuted() {
		this.setMuted(!this.muted);
		return this.muted;
	}

	setMuted(muted) {
		this.muted = muted;
		writeMuted(muted);
		this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.context.currentTime, 0.05);
	}

	// ----- Building blocks -----
	tone({ type = "sine", frequency, endFrequency = frequency, duration, volume = 0.3, attack = 0.005, when = 0, output = this.effectsBus }) {
		const start = this.context.currentTime + when;
		const oscillator = this.context.createOscillator();
		const gain = this.context.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, start);
		if (endFrequency !== frequency) {
			oscillator.frequency.exponentialRampToValueAtTime(Math.max(endFrequency, 1), start + duration);
		}
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(volume, start + attack);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
		oscillator.connect(gain).connect(output);
		oscillator.start(start);
		oscillator.stop(start + duration + 0.05);
	}

	noise({ duration, volume = 0.2, filterType = "highpass", filterFrequency = 2000, when = 0, output = this.effectsBus }) {
		const start = this.context.currentTime + when;
		const source = this.context.createBufferSource();
		source.buffer = this.noiseBuffer;
		const filter = this.context.createBiquadFilter();
		filter.type = filterType;
		filter.frequency.value = filterFrequency;
		const gain = this.context.createGain();
		gain.gain.setValueAtTime(volume, start);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
		source.connect(filter).connect(gain).connect(output);
		source.start(start, Math.random() * 0.5);
		source.stop(start + duration + 0.05);
	}

	// ----- Sound effects -----
	launch() {
		this.tone({ type: "triangle", frequency: 220, endFrequency: 880, duration: 0.25, volume: 0.25 });
	}

	paddle() {
		this.tone({ type: "sine", frequency: 330, endFrequency: 520, duration: 0.12, volume: 0.35 });
		this.tone({ type: "triangle", frequency: 660, duration: 0.08, volume: 0.1 });
	}

	wall() {
		this.tone({ type: "triangle", frequency: 260, endFrequency: 200, duration: 0.07, volume: 0.15 });
	}

	guard() {
		this.tone({ type: "sine", frequency: 520, endFrequency: 780, duration: 0.15, volume: 0.3 });
		this.noise({ duration: 0.1, volume: 0.08, filterFrequency: 4000 });
	}

	/**
	 * A glassy hit whose pitch climbs with the combo count. Long combos stack a fifth,
	 * then a sparkle on top, so a streak sounds richer and richer.
	 */
	brick(combo) {
		const note = 72 + PENTATONIC[clampIndex(combo - 1, 0, PENTATONIC.length - 1)];
		const frequency = midiToFrequency(note);
		this.tone({ type: "sine", frequency, duration: 0.35, volume: 0.28 });
		this.tone({ type: "sine", frequency: frequency * 2.01, duration: 0.2, volume: 0.08 });
		this.noise({ duration: 0.08, volume: 0.12, filterFrequency: 5000 });
		if (combo >= 8) {
			this.tone({ type: "triangle", frequency: frequency * 1.5, duration: 0.3, volume: 0.1, when: 0.02 });
		}
		if (combo >= 12) {
			this.tone({ type: "sine", frequency: frequency * 4, duration: 0.15, volume: 0.06, when: 0.04 });
			this.noise({ duration: 0.15, volume: 0.06, filterFrequency: 9000, when: 0.03 });
		}
	}

	/** A bright two-note chime for each coin. */
	coin() {
		const variation = 1 + (Math.random() - 0.5) * 0.04;
		this.tone({ type: "square", frequency: 1046 * variation, duration: 0.06, volume: 0.05 });
		this.tone({ type: "square", frequency: 1568 * variation, duration: 0.22, volume: 0.05, when: 0.06 });
	}

	/** A metallic ding for a golden brick that hasn't broken yet. */
	goldenHit() {
		this.tone({ type: "triangle", frequency: 1568, duration: 0.4, volume: 0.18 });
		this.tone({ type: "sine", frequency: 2637, duration: 0.3, volume: 0.1, when: 0.01 });
		this.noise({ duration: 0.12, volume: 0.1, filterType: "bandpass", filterFrequency: 3000 });
	}

	/** Slot-machine style fanfare: a fast run of notes, then a bell chord and a shower of coins. */
	jackpot() {
		for (let index = 0; index < 16; index++) {
			const note = 72 + PENTATONIC[index % PENTATONIC.length] + (index >= PENTATONIC.length ? 12 : 0);
			this.tone({ type: "square", frequency: midiToFrequency(note), duration: 0.06, volume: 0.06, when: index * 0.035 });
		}
		[0, 4, 7, 12, 16].forEach((interval) => {
			this.tone({ type: "triangle", frequency: midiToFrequency(79 + interval), duration: 0.9, volume: 0.1, when: 0.6 });
		});
		for (let index = 0; index < 8; index++) {
			this.tone({ type: "square", frequency: 1568 + Math.random() * 400, duration: 0.08, volume: 0.03, when: 0.7 + index * 0.07 });
		}
		this.noise({ duration: 1, volume: 0.08, filterFrequency: 7000, when: 0.6 });
	}

	/** A rising chord stab; higher combo tiers start higher. */
	comboTier(tier) {
		const root = 67 + tier * 3;
		[0, 4, 7, 12].forEach((interval, index) => {
			this.tone({ type: "sawtooth", frequency: midiToFrequency(root + interval), duration: 0.25, volume: 0.05, when: index * 0.03 });
			this.tone({ type: "triangle", frequency: midiToFrequency(root + interval + 12), duration: 0.3, volume: 0.07, when: index * 0.03 });
		});
		this.noise({ duration: 0.25, volume: 0.06, filterType: "bandpass", filterFrequency: 2500 + tier * 1500 });
	}

	/** Extra life jingle. */
	oneUp() {
		[0, 4, 7, 12, 16, 19, 24].forEach((interval, index) => {
			this.tone({ type: "square", frequency: midiToFrequency(76 + interval), duration: 0.1, volume: 0.06, when: index * 0.07 });
		});
	}

	beam() {
		this.tone({ type: "sawtooth", frequency: 1800, endFrequency: 300, duration: 0.12, volume: 0.08 });
		this.tone({ type: "square", frequency: 900, endFrequency: 1400, duration: 0.06, volume: 0.04 });
	}

	armor() {
		this.tone({ type: "square", frequency: 880, duration: 0.06, volume: 0.06 });
		this.tone({ type: "square", frequency: 1320, duration: 0.05, volume: 0.04, when: 0.02 });
	}

	steel() {
		this.tone({ type: "triangle", frequency: 140, endFrequency: 90, duration: 0.15, volume: 0.3 });
		this.noise({ duration: 0.05, volume: 0.1, filterType: "bandpass", filterFrequency: 1200 });
	}

	ice() {
		this.noise({ duration: 0.35, volume: 0.25, filterFrequency: 3500 });
		[2093, 2637, 3136, 3951].forEach((frequency, index) => {
			this.tone({ type: "sine", frequency, duration: 0.4, volume: 0.07, when: index * 0.03 });
		});
	}

	pickup() {
		[0, 4, 7, 12].forEach((interval, index) => {
			this.tone({ type: "triangle", frequency: midiToFrequency(72 + interval), duration: 0.18, volume: 0.22, when: index * 0.06 });
		});
	}

	bossHit() {
		this.tone({ type: "square", frequency: 220, endFrequency: 110, duration: 0.12, volume: 0.12 });
		this.noise({ duration: 0.12, volume: 0.15, filterType: "bandpass", filterFrequency: 900 });
	}

	bossDown() {
		this.noise({ duration: 1.2, volume: 0.3, filterType: "lowpass", filterFrequency: 1200 });
		this.tone({ type: "sawtooth", frequency: 300, endFrequency: 40, duration: 1.1, volume: 0.2 });
		[0, 7, 12, 19].forEach((interval, index) => {
			this.tone({ type: "triangle", frequency: midiToFrequency(72 + interval), duration: 0.3, volume: 0.15, when: 0.5 + index * 0.07 });
		});
	}

	/** A mast cell releasing a histamine granule. */
	histamine() {
		this.tone({ type: "sine", frequency: 700, endFrequency: 250, duration: 0.18, volume: 0.12 });
	}

	itch() {
		[0, 1, 0, 1].forEach((step, index) => {
			this.tone({ type: "square", frequency: step ? 520 : 460, duration: 0.05, volume: 0.07, when: index * 0.05 });
		});
	}

	pauseChime() {
		this.tone({ type: "triangle", frequency: 988, duration: 0.08, volume: 0.15 });
		this.tone({ type: "triangle", frequency: 1319, duration: 0.12, volume: 0.15, when: 0.08 });
	}

	/** Power-up fanfare for the Konami code. */
	maxPower() {
		[0, 4, 7, 12, 16, 19, 24, 28].forEach((interval, index) => {
			this.tone({ type: "square", frequency: midiToFrequency(60 + interval), duration: 0.12, volume: 0.1, when: index * 0.05 });
			this.tone({ type: "triangle", frequency: midiToFrequency(72 + interval), duration: 0.2, volume: 0.12, when: index * 0.05 });
		});
		this.noise({ duration: 0.6, volume: 0.08, filterFrequency: 6000, when: 0.4 });
	}

	loseBall() {
		this.tone({ type: "sawtooth", frequency: 420, endFrequency: 70, duration: 0.6, volume: 0.18 });
		this.noise({ duration: 0.4, volume: 0.15, filterType: "lowpass", filterFrequency: 600 });
	}

	stageClear() {
		[0, 4, 7, 12, 16, 19, 24].forEach((interval, index) => {
			this.tone({ type: "triangle", frequency: midiToFrequency(67 + interval), duration: 0.35, volume: 0.22, when: index * 0.08 });
		});
	}

	allClear() {
		const melody = [0, 4, 7, 12, 7, 12, 16, 19, 24];
		melody.forEach((interval, index) => {
			this.tone({ type: "triangle", frequency: midiToFrequency(67 + interval), duration: 0.45, volume: 0.22, when: index * 0.12 });
			this.tone({ type: "sine", frequency: midiToFrequency(55 + interval), duration: 0.45, volume: 0.12, when: index * 0.12 });
		});
		this.noise({ duration: 1.5, volume: 0.06, filterFrequency: 6000, when: 0.9 });
	}

	gameOver() {
		[7, 3, 0, -5].forEach((interval, index) => {
			this.tone({ type: "triangle", frequency: midiToFrequency(57 + interval), duration: 0.5, volume: 0.2, when: index * 0.22 });
		});
	}

	// ----- Music -----
	/**
	 * Starts a simple generative arpeggio loop.
	 * @param {{ tempo: number, rootNote: number }} options
	 */
	startMusic({ tempo, rootNote }) {
		this.stopMusic();
		const sixteenth = 60 / tempo / 4;
		let step = 0;
		let nextNoteTime = this.context.currentTime + 0.1;

		const scheduleStep = (time) => {
			const bar = Math.floor(step / 16) % PROGRESSION.length;
			const chordRoot = rootNote + PROGRESSION[bar];
			const stepInBar = step % 16;

			if (step % 2 === 0) {
				const degree = PENTATONIC[ARPEGGIO_PATTERN[(step / 2) % ARPEGGIO_PATTERN.length]];
				this.musicNote({ type: "triangle", note: chordRoot + 12 + degree, time, duration: sixteenth * 1.8, volume: 0.35 });
			}
			if (stepInBar % 8 === 0) {
				this.musicNote({ type: "sine", note: chordRoot - 12, time, duration: sixteenth * 7, volume: 0.6 });
			}
			if (stepInBar % 4 === 2) {
				this.noise({ duration: 0.04, volume: 0.25, filterFrequency: 7000, when: time - this.context.currentTime, output: this.musicBus });
			}
			if (stepInBar === 0 || stepInBar === 8) {
				this.musicNote({ type: "sine", note: 33, time, duration: 0.18, volume: 0.7, endNote: 21 });
			}
			step += 1;
		};

		this.musicTimer = setInterval(() => {
			while (nextNoteTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
				scheduleStep(nextNoteTime);
				nextNoteTime += sixteenth;
			}
		}, SCHEDULER_INTERVAL_MS);
	}

	musicNote({ type, note, time, duration, volume, endNote = note }) {
		this.tone({
			type,
			frequency: midiToFrequency(note),
			endFrequency: midiToFrequency(endNote),
			duration,
			volume,
			attack: 0.01,
			when: Math.max(time - this.context.currentTime, 0),
			output: this.musicBus,
		});
	}

	stopMusic() {
		clearInterval(this.musicTimer);
		this.musicTimer = undefined;
	}

	dispose() {
		this.stopMusic();
		this.context.close().catch(() => {});
	}
}

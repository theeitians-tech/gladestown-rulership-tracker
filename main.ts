import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from "obsidian";

/* ------------------------------------------------------------------ */
/*  Constants & Types                                                  */
/* ------------------------------------------------------------------ */

export const VIEW_TYPE_GLADESTOWN = "gladestown-tracker-view";

type StatKey = "stability" | "loyalty" | "renown" | "military";

interface LawDef {
	num: number;
	id: string;
	name: string;
	category: string;
	goldCost: number; // one-time, 0 if none
	upkeepDelta: number; // recurring gp/month added to upkeep
	incomeDeltaPercent: number; // recurring, e.g. 0.10 = +10% income
	immediate: Partial<Record<StatKey | "unrest", number>>;
	recurring: boolean; // whether it has an ongoing effect and can be "repealed"
	notes: string;
}

interface LogEntry {
	day: number; // in-game day counter at time of entry
	turn: number; // court turn number at time of entry
	message: string;
	timestamp: number;
}

interface CityState {
	stability: number;
	loyalty: number;
	renown: number;
	military: number;
	unrest: number;

	treasuryReserve: number;
	startingReserve: number;
	baseIncome: number;
	baseUpkeep: number;

	actionPoints: number;
	actionPointsMax: number;

	courtTurnNumber: number;
	currentDay: number; // days elapsed since last court turn
	daysPerCourtTurn: number;
	daysPerLongRest: number;
	turnsSinceChallenge: number;

	activeLawIds: string[];

	log: LogEntry[];
}

const DEFAULT_STATE: CityState = {
	stability: 10,
	loyalty: 10,
	renown: 5,
	military: 5,
	unrest: 6,

	treasuryReserve: 2500000,
	startingReserve: 2500000,
	baseIncome: 60000,
	baseUpkeep: 60000,

	actionPoints: 3,
	actionPointsMax: 3,

	courtTurnNumber: 1,
	currentDay: 0,
	daysPerCourtTurn: 30,
	daysPerLongRest: 1,
	turnsSinceChallenge: 0,

	activeLawIds: [],

	log: [
		{
			day: 0,
			turn: 1,
			message: "Campaign tracker initialized.",
			timestamp: Date.now(),
		},
	],
};

/* ------------------------------------------------------------------ */
/*  Tier helpers                                                       */
/* ------------------------------------------------------------------ */

function tierOf(value: number): "Crisis" | "Weak" | "Sound" | "Strong" | "Legendary" {
	if (value <= 4) return "Crisis";
	if (value <= 9) return "Weak";
	if (value <= 14) return "Sound";
	if (value <= 19) return "Strong";
	return "Legendary";
}

function tierClass(value: number): string {
	return "gt-tier-" + tierOf(value).toLowerCase();
}

const STAT_LABELS: Record<StatKey, string> = {
	stability: "Stability",
	loyalty: "Loyalty",
	renown: "Renown",
	military: "Military",
};

/* ------------------------------------------------------------------ */
/*  Laws data (the 30-law menu)                                        */
/* ------------------------------------------------------------------ */

const LAWS: LawDef[] = [
	{ num: 1, id: "flat-tax", name: "Flat Tax Increase", category: "Taxation & Economy", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0.15, immediate: { loyalty: -2 }, recurring: true, notes: "Income +15% (recurring) / Loyalty -2" },
	{ num: 2, id: "progressive-tax", name: "Progressive Tax Reform", category: "Taxation & Economy", goldCost: 20000, upkeepDelta: 0, incomeDeltaPercent: 0.05, immediate: { loyalty: 2 }, recurring: true, notes: "Loyalty +2 / Income +5% (recurring)" },
	{ num: 3, id: "merchant-guild", name: "Merchant Guild Charter", category: "Taxation & Economy", goldCost: 15000, upkeepDelta: 0, incomeDeltaPercent: 0.10, immediate: { renown: 1 }, recurring: true, notes: "Renown +1 / Income +10% (recurring). Requires Renown 5+" },
	{ num: 4, id: "tax-amnesty", name: "Tax Amnesty / Debt Forgiveness", category: "Taxation & Economy", goldCost: 50000, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { loyalty: 3, unrest: -2 }, recurring: false, notes: "Loyalty +3 / Unrest -2" },
	{ num: 5, id: "luxury-tax", name: "Luxury Tax on Nobility", category: "Taxation & Economy", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0.10, immediate: { loyalty: 1 }, recurring: true, notes: "Income +10% / Loyalty +1 (commons). Flags nobles as an Unrest source - track manually." },
	{ num: 6, id: "granary", name: "Public Granary & Price Controls", category: "Taxation & Economy", goldCost: 0, upkeepDelta: 10000, incomeDeltaPercent: 0, immediate: { stability: 2 }, recurring: true, notes: "Stability +2, prevents famine-triggered Crisis events" },

	{ num: 7, id: "expand-watch", name: "Expand the City Watch", category: "Order & Judiciary", goldCost: 0, upkeepDelta: 15000, incomeDeltaPercent: 0, immediate: { stability: 2, military: 1 }, recurring: true, notes: "Stability +2 / Military +1" },
	{ num: 8, id: "harsh-punishments", name: "Harsh Punishments Act", category: "Order & Judiciary", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { stability: 3, loyalty: -3 }, recurring: false, notes: "Stability +3 (immediate) / Loyalty -3" },
	{ num: 9, id: "fair-courts", name: "Fair Courts Reform", category: "Order & Judiciary", goldCost: 25000, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { loyalty: 2, stability: 1 }, recurring: false, notes: "Loyalty +2, Stability +1 (slow, over next 2 turns)" },
	{ num: 10, id: "anti-corruption", name: "Anti-Corruption Purge", category: "Order & Judiciary", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { stability: 2, loyalty: 2 }, recurring: false, notes: "Stability +2 / Loyalty +2. A rough roll may create a vengeful enemy - track manually." },
	{ num: 11, id: "curfew", name: "Emergency Curfew", category: "Order & Judiciary", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { stability: 3 }, recurring: true, notes: "Stability +3, only while Stability is Crisis tier. Loyalty -1/turn while active - repeal when done." },

	{ num: 12, id: "standing-army", name: "Standing Army Charter", category: "Military", goldCost: 100000, upkeepDelta: 100000, incomeDeltaPercent: 0, immediate: { military: 3 }, recurring: true, notes: "Military +3, ongoing upkeep" },
	{ num: 13, id: "fortify-walls", name: "Fortify City Walls", category: "Military", goldCost: 80000, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { military: 2, stability: 1 }, recurring: false, notes: "Military +2 / Stability +1, permanent, no upkeep increase" },
	{ num: 14, id: "militia-training", name: "Militia Training Program", category: "Military", goldCost: 10000, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { military: 1, loyalty: 1 }, recurring: false, notes: "Military +1 / Loyalty +1 (civic pride)" },
	{ num: 15, id: "mercenaries", name: "Mercenary Contract", category: "Military", goldCost: 0, upkeepDelta: 40000, incomeDeltaPercent: 0, immediate: { military: 3 }, recurring: true, notes: "Military +3 immediately. They leave (Military -3) if upkeep goes unpaid." },
	{ num: 16, id: "veteran-officers", name: "Veteran Officer Corps", category: "Military", goldCost: 20000, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { military: 1 }, recurring: false, notes: "Military +1. Requires a quest-earned officer NPC. Unlocks better war odds." },

	{ num: 17, id: "trade-charter", name: "Open Trade Charter", category: "Diplomacy & Trade", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0.10, immediate: { renown: 1 }, recurring: true, notes: "Income +10% (recurring) / Renown +1. Requires a successful Broker Trade action first." },
	{ num: 18, id: "alliance-pact", name: "Political Marriage / Alliance Pact", category: "Diplomacy & Trade", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { renown: 2, loyalty: 1 }, recurring: false, notes: "Renown +2 / Loyalty +1, heavy roleplay hook" },
	{ num: 19, id: "refugee-settlement", name: "Refugee Settlement Act", category: "Diplomacy & Trade", goldCost: 15000, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { loyalty: 2, stability: -1 }, recurring: false, notes: "Loyalty +2, Stability -1 short term, then +1 permanently after 2 turns (apply manually)" },
	{ num: 20, id: "embassy", name: "Foreign Embassy", category: "Diplomacy & Trade", goldCost: 0, upkeepDelta: 10000, incomeDeltaPercent: 0, immediate: { renown: 1 }, recurring: true, notes: "Renown +1, unlocks foreign aid for the endgame war" },
	{ num: 21, id: "non-aggression", name: "Non-Aggression Treaty", category: "Diplomacy & Trade", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { renown: -1 }, recurring: false, notes: "Reduces chance of an External Unrest trigger; Renown -1" },

	{ num: 22, id: "festival", name: "Festival of the Lord's Favor", category: "Social & Culture", goldCost: 25000, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { loyalty: 2, unrest: -1 }, recurring: false, notes: "Loyalty +2 (immediate) / Unrest -1, one-time" },
	{ num: 23, id: "temple-patronage", name: "Temple Patronage", category: "Social & Culture", goldCost: 0, upkeepDelta: 8000, incomeDeltaPercent: 0, immediate: { loyalty: 1, stability: 1 }, recurring: true, notes: "Loyalty +1, Stability +1 (slow), unlocks divine-favor hooks" },
	{ num: 24, id: "public-works", name: "Public Works: Roads & Aqueduct", category: "Social & Culture", goldCost: 60000, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { stability: 3 }, recurring: false, notes: "Stability +3, permanent" },
	{ num: 25, id: "guild-rights", name: "Guild Rights Charter", category: "Social & Culture", goldCost: 15000, upkeepDelta: 0, incomeDeltaPercent: 0.05, immediate: { stability: 1, loyalty: 1 }, recurring: true, notes: "Income +5% (recurring), Stability +1, Loyalty +1" },
	{ num: 26, id: "sponsor-arts", name: "Sponsor the Arts / Academy", category: "Social & Culture", goldCost: 0, upkeepDelta: 12000, incomeDeltaPercent: 0, immediate: { renown: 1 }, recurring: true, notes: "Renown +1 (slow), unlocks unique recruitable NPCs" },

	{ num: 27, id: "martial-law", name: "Martial Law", category: "Emergency & Special", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { stability: 4, loyalty: -4 }, recurring: true, notes: "Only while Stability is Crisis. Repeal within 3 turns or Loyalty keeps dropping - track manually." },
	{ num: 28, id: "amnesty-challenger", name: "Amnesty for a Challenger", category: "Emergency & Special", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: { renown: -1 }, recurring: false, notes: "Resolves one specific brewing Unrest source without combat; Renown -1. Adjust Unrest manually." },
	{ num: 29, id: "abdication-clause", name: "Formal Abdication Clause", category: "Emergency & Special", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0, immediate: {}, recurring: false, notes: "No stat effect. Defines a peaceful succession process." },
	{ num: 30, id: "war-tax", name: "War Tax (Emergency Levy)", category: "Emergency & Special", goldCost: 0, upkeepDelta: 0, incomeDeltaPercent: 0.40, immediate: { loyalty: -3 }, recurring: true, notes: "Income +40% while active (temporary - repeal after ~3 turns) / Loyalty -3" },
];

const LAW_CATEGORIES = [
	"Taxation & Economy",
	"Order & Judiciary",
	"Military",
	"Diplomacy & Trade",
	"Social & Culture",
	"Emergency & Special",
];

/* ------------------------------------------------------------------ */
/*  Economy calculations                                               */
/* ------------------------------------------------------------------ */

const INCOME_MOD_STABILITY: Record<string, number> = { Crisis: -0.30, Weak: -0.10, Sound: 0, Strong: 0.15, Legendary: 0.25 };
const INCOME_MOD_LOYALTY: Record<string, number> = { Crisis: -0.25, Weak: -0.10, Sound: 0, Strong: 0.10, Legendary: 0.20 };
const INCOME_MOD_RENOWN: Record<string, number> = { Crisis: -0.10, Weak: 0, Sound: 0.05, Strong: 0.15, Legendary: 0.30 };
const UPKEEP_FLAT_MILITARY: Record<string, number> = { Crisis: 0, Weak: 10000, Sound: 30000, Strong: 60000, Legendary: 100000 };
const UPKEEP_FLAT_STABILITY: Record<string, number> = { Crisis: 20000, Weak: 5000, Sound: 0, Strong: 0, Legendary: 0 };

function computeEconomy(state: CityState) {
	const activeLaws = LAWS.filter((l) => state.activeLawIds.includes(l.id));

	let incomeMod =
		INCOME_MOD_STABILITY[tierOf(state.stability)] +
		INCOME_MOD_LOYALTY[tierOf(state.loyalty)] +
		INCOME_MOD_RENOWN[tierOf(state.renown)];
	let lawIncomeMod = 0;
	let lawUpkeepFlat = 0;
	for (const law of activeLaws) {
		lawIncomeMod += law.incomeDeltaPercent;
		lawUpkeepFlat += law.upkeepDelta;
	}
	incomeMod += lawIncomeMod;

	const income = Math.round(state.baseIncome * (1 + incomeMod));
	const upkeep = Math.round(
		state.baseUpkeep +
			UPKEEP_FLAT_MILITARY[tierOf(state.military)] +
			UPKEEP_FLAT_STABILITY[tierOf(state.stability)] +
			lawUpkeepFlat
	);
	const netFlow = income - upkeep;
	const reserveRatio = state.startingReserve > 0 ? state.treasuryReserve / state.startingReserve : 0;

	let ratioTier: string;
	let ratioUnrestDelta = 0;
	if (reserveRatio >= 1.0) ratioTier = "Flush";
	else if (reserveRatio >= 0.75) ratioTier = "Comfortable";
	else if (reserveRatio >= 0.5) {
		ratioTier = "Strained";
		ratioUnrestDelta = 1;
	} else if (reserveRatio >= 0.25) {
		ratioTier = "Crisis";
		ratioUnrestDelta = 2;
	} else {
		ratioTier = "Insolvent";
		ratioUnrestDelta = 3;
	}

	return { income, upkeep, netFlow, reserveRatio, ratioTier, ratioUnrestDelta };
}

/* ------------------------------------------------------------------ */
/*  Plugin settings                                                    */
/* ------------------------------------------------------------------ */

interface GladestownSettings {
	daysPerCourtTurn: number;
	defaultDaysPerLongRest: number;
}

const DEFAULT_SETTINGS: GladestownSettings = {
	daysPerCourtTurn: 30,
	defaultDaysPerLongRest: 1,
};

/* ------------------------------------------------------------------ */
/*  Main plugin class                                                  */
/* ------------------------------------------------------------------ */

export default class GladestownPlugin extends Plugin {
	settings: GladestownSettings;
	state: CityState;

	async onload() {
		await this.loadSettings();
		await this.loadState();

		this.registerView(VIEW_TYPE_GLADESTOWN, (leaf) => new GladestownView(leaf, this));

		this.addRibbonIcon("castle", "Open Gladestown Tracker", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-gladestown-tracker",
			name: "Open Gladestown Tracker",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "gladestown-long-rest",
			name: "Log a Long Rest",
			callback: () => {
				this.applyLongRest(this.settings.defaultDaysPerLongRest);
			},
		});

		this.addSettingTab(new GladestownSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadState() {
		const data = await this.loadData();
		if (data && data.cityState) {
			this.state = Object.assign({}, DEFAULT_STATE, data.cityState);
		} else {
			this.state = Object.assign({}, DEFAULT_STATE);
		}
	}

	async persist() {
		const data = (await this.loadData()) || {};
		data.cityState = this.state;
		data.daysPerCourtTurn = this.settings.daysPerCourtTurn;
		data.defaultDaysPerLongRest = this.settings.defaultDaysPerLongRest;
		await this.saveData(data);
		this.refreshViews();
	}

	refreshViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GLADESTOWN)) {
			if (leaf.view instanceof GladestownView) leaf.view.render();
		}
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_GLADESTOWN);
		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_GLADESTOWN, active: true });
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	log(message: string) {
		this.state.log.unshift({
			day: this.state.currentDay,
			turn: this.state.courtTurnNumber,
			message,
			timestamp: Date.now(),
		});
		if (this.state.log.length > 300) this.state.log.pop();
	}

	/* ---- Core actions ---- */

	applyLongRest(days: number) {
		this.state.currentDay += days;
		this.log(`Long rest taken. +${days} day(s) (day ${this.state.currentDay}/${this.state.daysPerCourtTurn} of this court cycle).`);
		if (this.state.currentDay >= this.state.daysPerCourtTurn) {
			new Notice("Gladestown: Court Turn is now due!");
		}
		this.persist();
	}

	adjustStat(stat: StatKey, delta: number) {
		this.state[stat] = Math.max(0, Math.min(20, this.state[stat] + delta));
		this.log(`${STAT_LABELS[stat]} ${delta >= 0 ? "+" : ""}${delta} (now ${this.state[stat]}).`);
		this.persist();
	}

	adjustUnrest(delta: number) {
		this.state.unrest = Math.max(0, Math.min(20, this.state.unrest + delta));
		this.log(`Unrest ${delta >= 0 ? "+" : ""}${delta} (now ${this.state.unrest}).`);
		this.persist();
	}

	adjustGold(delta: number) {
		this.state.treasuryReserve += delta;
		this.log(`Treasury ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} gp (now ${this.state.treasuryReserve.toLocaleString()} gp).`);
		this.persist();
	}

	spendActionPoint(n = 1) {
		this.state.actionPoints = Math.max(0, this.state.actionPoints - n);
		this.persist();
	}

	enactLaw(lawId: string) {
		const law = LAWS.find((l) => l.id === lawId);
		if (!law) return;
		if (law.goldCost > 0) {
			this.state.treasuryReserve -= law.goldCost;
		}
		for (const [key, val] of Object.entries(law.immediate)) {
			if (key === "unrest") {
				this.state.unrest = Math.max(0, Math.min(20, this.state.unrest + (val as number)));
			} else {
				const k = key as StatKey;
				this.state[k] = Math.max(0, Math.min(20, this.state[k] + (val as number)));
			}
		}
		if (law.recurring && !this.state.activeLawIds.includes(law.id)) {
			this.state.activeLawIds.push(law.id);
		}
		this.log(`Enacted law: ${law.name}${law.goldCost ? ` (-${law.goldCost.toLocaleString()} gp)` : ""}.`);
		this.persist();
	}

	repealLaw(lawId: string) {
		const law = LAWS.find((l) => l.id === lawId);
		if (!law) return;
		this.state.activeLawIds = this.state.activeLawIds.filter((id) => id !== lawId);
		this.log(`Repealed law: ${law.name}.`);
		this.persist();
	}

	advanceCourtTurn(opts: { treasuryFlaunted: boolean; heldCourtOrInvestigated: boolean }) {
		const econ = computeEconomy(this.state);
		this.state.treasuryReserve += econ.netFlow;

		let unrestDelta = econ.ratioUnrestDelta;
		const stabT = tierOf(this.state.stability);
		const loyT = tierOf(this.state.loyalty);
		const renT = tierOf(this.state.renown);

		if (stabT === "Crisis") unrestDelta += 2;
		if (stabT === "Strong" || stabT === "Legendary") unrestDelta -= 1;
		if (loyT === "Crisis") unrestDelta += 3;
		if (loyT === "Strong" || loyT === "Legendary") unrestDelta -= 1;
		if (renT === "Strong" || renT === "Legendary") unrestDelta += 1;
		if (opts.treasuryFlaunted) unrestDelta += 1;
		if (opts.heldCourtOrInvestigated) unrestDelta -= 1;
		if (this.state.turnsSinceChallenge >= 3) unrestDelta += 1;

		this.state.unrest = Math.max(0, Math.min(20, this.state.unrest + unrestDelta));

		// Reserve-ratio austerity penalties
		if (econ.ratioTier === "Crisis") {
			this.state.stability = Math.max(0, this.state.stability - 1);
		} else if (econ.ratioTier === "Insolvent") {
			this.state.stability = Math.max(0, this.state.stability - 2);
			this.state.loyalty = Math.max(0, this.state.loyalty - 2);
		}

		this.log(
			`Court Turn ${this.state.courtTurnNumber} resolved. Net flow ${econ.netFlow >= 0 ? "+" : ""}${econ.netFlow.toLocaleString()} gp (Reserve: ${econ.ratioTier}). Unrest ${unrestDelta >= 0 ? "+" : ""}${unrestDelta} (now ${this.state.unrest}).`
		);

		this.state.courtTurnNumber += 1;
		this.state.currentDay = 0;
		this.state.actionPoints = Math.min(this.state.actionPointsMax * 2, this.state.actionPoints + this.state.actionPointsMax);
		this.state.turnsSinceChallenge += 1;

		this.persist();
	}

	resolveChallenge(newUnrest: number) {
		this.state.unrest = Math.max(0, Math.min(20, newUnrest));
		this.state.turnsSinceChallenge = 0;
		this.log(`A challenge was resolved. Unrest reset to ${this.state.unrest}.`);
		this.persist();
	}
}

/* ------------------------------------------------------------------ */
/*  View (sidebar dashboard)                                           */
/* ------------------------------------------------------------------ */

class GladestownView extends ItemView {
	plugin: GladestownPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: GladestownPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_GLADESTOWN;
	}

	getDisplayText() {
		return "Gladestown Tracker";
	}

	getIcon() {
		return "castle";
	}

	async onOpen() {
		this.render();
	}

	async onClose() {}

	render() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("gladestown-tracker-root");
		const s = this.plugin.state;
		const econ = computeEconomy(s);

		/* ---- Court Date banner ---- */
		const banner = container.createDiv({ cls: "gt-section gt-court-banner" });
		const dueSoon = s.currentDay >= s.daysPerCourtTurn;
		banner.toggleClass("gt-court-due", dueSoon);
		banner.createEl("div", {
			text: dueSoon
				? `Court Turn ${s.courtTurnNumber} is due! (Day ${s.currentDay}/${s.daysPerCourtTurn})`
				: `Court Turn ${s.courtTurnNumber} — Day ${s.currentDay}/${s.daysPerCourtTurn}`,
			cls: "gt-banner-text",
		});
		const progressWrap = banner.createDiv({ cls: "gt-progress-wrap" });
		const pct = Math.min(100, (s.currentDay / s.daysPerCourtTurn) * 100);
		const bar = progressWrap.createDiv({ cls: "gt-progress-bar" });
		bar.style.width = pct + "%";

		const restRow = banner.createDiv({ cls: "gt-button-row" });
		const restBtn = restRow.createEl("button", { text: `🌙 Long Rest (+${this.plugin.settings.defaultDaysPerLongRest}d)`, cls: "gt-btn gt-btn-primary" });
		restBtn.onclick = () => this.plugin.applyLongRest(this.plugin.settings.defaultDaysPerLongRest);

		const customRestBtn = restRow.createEl("button", { text: "Custom days...", cls: "gt-btn" });
		customRestBtn.onclick = () => {
			const val = window.prompt("How many in-game days passed during this long rest?", String(this.plugin.settings.defaultDaysPerLongRest));
			if (val === null) return;
			const n = parseFloat(val);
			if (!isNaN(n) && n > 0) this.plugin.applyLongRest(n);
		};

		/* ---- Court Turn action ---- */
		const courtRow = banner.createDiv({ cls: "gt-button-row" });
		const courtBtn = courtRow.createEl("button", { text: "⚖️ Process Court Turn", cls: "gt-btn gt-btn-accent" });
		courtBtn.onclick = () => {
			const flaunted = window.confirm("Was city wealth publicly flaunted this turn? (OK = yes, Cancel = no)");
			const held = window.confirm("Did the party Hold Court or Investigate this turn? (OK = yes, Cancel = no)");
			this.plugin.advanceCourtTurn({ treasuryFlaunted: flaunted, heldCourtOrInvestigated: held });
			new Notice(`Court Turn resolved. New turn: ${this.plugin.state.courtTurnNumber}.`);
		};

		/* ---- Stats ---- */
		const statsSection = container.createDiv({ cls: "gt-section" });
		statsSection.createEl("h4", { text: "City Pillars" });
		const statKeys: StatKey[] = ["stability", "loyalty", "renown", "military"];
		for (const key of statKeys) {
			const row = statsSection.createDiv({ cls: "gt-stat-row" });
			row.createSpan({ text: STAT_LABELS[key], cls: "gt-stat-label" });
			const minus = row.createEl("button", { text: "−", cls: "gt-btn gt-btn-sm" });
			minus.onclick = () => this.plugin.adjustStat(key, -1);
			row.createSpan({ text: String(s[key]), cls: "gt-stat-value" });
			const plus = row.createEl("button", { text: "+", cls: "gt-btn gt-btn-sm" });
			plus.onclick = () => this.plugin.adjustStat(key, 1);
			row.createSpan({ text: tierOf(s[key]), cls: "gt-tier-badge " + tierClass(s[key]) });
		}

		/* ---- Unrest ---- */
		const unrestSection = container.createDiv({ cls: "gt-section" });
		unrestSection.createEl("h4", { text: "Unrest" });
		const uRow = unrestSection.createDiv({ cls: "gt-stat-row" });
		uRow.createSpan({ text: "Unrest", cls: "gt-stat-label" });
		const uMinus = uRow.createEl("button", { text: "−", cls: "gt-btn gt-btn-sm" });
		uMinus.onclick = () => this.plugin.adjustUnrest(-1);
		uRow.createSpan({ text: String(s.unrest) + " / 20", cls: "gt-stat-value" });
		const uPlus = uRow.createEl("button", { text: "+", cls: "gt-btn gt-btn-sm" });
		uPlus.onclick = () => this.plugin.adjustUnrest(1);
		unrestSection.createEl("div", {
			text: `Turns since last challenge: ${s.turnsSinceChallenge}`,
			cls: "gt-small-note",
		});
		const resolveBtn = unrestSection.createEl("button", { text: "Resolve a Challenge...", cls: "gt-btn" });
		resolveBtn.onclick = () => {
			const val = window.prompt("Challenge resolved. Set new Unrest value:", "8");
			if (val === null) return;
			const n = parseInt(val, 10);
			if (!isNaN(n)) this.plugin.resolveChallenge(n);
		};

		/* ---- Treasury ---- */
		const treasurySection = container.createDiv({ cls: "gt-section" });
		treasurySection.createEl("h4", { text: "Treasury" });
		const goldRow = treasurySection.createDiv({ cls: "gt-stat-row" });
		goldRow.createSpan({ text: "Reserve", cls: "gt-stat-label" });
		goldRow.createSpan({ text: s.treasuryReserve.toLocaleString() + " gp", cls: "gt-stat-value" });
		const goldBtns = treasurySection.createDiv({ cls: "gt-button-row" });
		const addGoldBtn = goldBtns.createEl("button", { text: "Adjust gold...", cls: "gt-btn" });
		addGoldBtn.onclick = () => {
			const val = window.prompt("Add/subtract gold (use negative for spending):", "0");
			if (val === null) return;
			const n = parseFloat(val);
			if (!isNaN(n)) this.plugin.adjustGold(n);
		};

		const econGrid = treasurySection.createDiv({ cls: "gt-econ-grid" });
		this.econStat(econGrid, "Monthly Income", econ.income.toLocaleString() + " gp");
		this.econStat(econGrid, "Monthly Upkeep", econ.upkeep.toLocaleString() + " gp");
		this.econStat(econGrid, "Net Flow", (econ.netFlow >= 0 ? "+" : "") + econ.netFlow.toLocaleString() + " gp");
		this.econStat(econGrid, "Reserve Ratio", Math.round(econ.reserveRatio * 100) + "% (" + econ.ratioTier + ")");

		/* ---- Action Points ---- */
		const apSection = container.createDiv({ cls: "gt-section" });
		apSection.createEl("h4", { text: "Action Points" });
		const apRow = apSection.createDiv({ cls: "gt-stat-row" });
		apRow.createSpan({ text: "Available", cls: "gt-stat-label" });
		const apMinus = apRow.createEl("button", { text: "Spend 1", cls: "gt-btn gt-btn-sm" });
		apMinus.onclick = () => this.plugin.spendActionPoint(1);
		apRow.createSpan({ text: String(s.actionPoints), cls: "gt-stat-value" });

		/* ---- Laws ---- */
		const lawsSection = container.createDiv({ cls: "gt-section" });
		lawsSection.createEl("h4", { text: "Laws & Decrees" });
		for (const cat of LAW_CATEGORIES) {
			const catDetails = lawsSection.createEl("details", { cls: "gt-law-category" });
			catDetails.createEl("summary", { text: cat });
			for (const law of LAWS.filter((l) => l.category === cat)) {
				const active = s.activeLawIds.includes(law.id);
				const lawRow = catDetails.createDiv({ cls: "gt-law-row" + (active ? " gt-law-active" : "") });
				const lawHeader = lawRow.createDiv({ cls: "gt-law-header" });
				lawHeader.createSpan({ text: `${law.num}. ${law.name}`, cls: "gt-law-name" });
				if (law.goldCost > 0) lawHeader.createSpan({ text: `${law.goldCost.toLocaleString()} gp`, cls: "gt-law-cost" });
				lawRow.createDiv({ text: law.notes, cls: "gt-law-notes" });
				const btnRow = lawRow.createDiv({ cls: "gt-button-row" });
				if (!active) {
					const enactBtn = btnRow.createEl("button", { text: "Enact", cls: "gt-btn gt-btn-sm" });
					enactBtn.onclick = () => this.plugin.enactLaw(law.id);
				} else {
					btnRow.createSpan({ text: "Active", cls: "gt-law-active-badge" });
					if (law.recurring) {
						const repealBtn = btnRow.createEl("button", { text: "Repeal", cls: "gt-btn gt-btn-sm" });
						repealBtn.onclick = () => this.plugin.repealLaw(law.id);
					}
				}
			}
		}

		/* ---- Log ---- */
		const logSection = container.createDiv({ cls: "gt-section" });
		logSection.createEl("h4", { text: "Court Log" });
		const logList = logSection.createDiv({ cls: "gt-log-list" });
		for (const entry of s.log.slice(0, 50)) {
			const entryEl = logList.createDiv({ cls: "gt-log-entry" });
			entryEl.createSpan({ text: `T${entry.turn} · D${entry.day}`, cls: "gt-log-meta" });
			entryEl.createSpan({ text: entry.message, cls: "gt-log-message" });
		}
	}

	econStat(parent: HTMLElement, label: string, value: string) {
		const cell = parent.createDiv({ cls: "gt-econ-cell" });
		cell.createDiv({ text: label, cls: "gt-econ-label" });
		cell.createDiv({ text: value, cls: "gt-econ-value" });
	}
}

/* ------------------------------------------------------------------ */
/*  Settings tab                                                       */
/* ------------------------------------------------------------------ */

class GladestownSettingTab extends PluginSettingTab {
	plugin: GladestownPlugin;

	constructor(app: App, plugin: GladestownPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Gladestown Rulership Tracker Settings" });

		new Setting(containerEl)
			.setName("Days per Court Turn")
			.setDesc("How many in-game days make up one Court Turn cycle (default 30).")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.daysPerCourtTurn)).onChange(async (value) => {
					const n = parseInt(value, 10);
					if (!isNaN(n) && n > 0) {
						this.plugin.settings.daysPerCourtTurn = n;
						this.plugin.state.daysPerCourtTurn = n;
						await this.plugin.saveSettings();
						await this.plugin.persist();
					}
				})
			);

		new Setting(containerEl)
			.setName("Default days per Long Rest")
			.setDesc("How many in-game days the Long Rest button adds by default. You can override this per-click with 'Custom days...'.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.defaultDaysPerLongRest)).onChange(async (value) => {
					const n = parseFloat(value);
					if (!isNaN(n) && n > 0) {
						this.plugin.settings.defaultDaysPerLongRest = n;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}
				})
			);

		new Setting(containerEl)
			.setName("Base monthly income (gp)")
			.addText((text) =>
				text.setValue(String(this.plugin.state.baseIncome)).onChange(async (value) => {
					const n = parseFloat(value);
					if (!isNaN(n) && n >= 0) {
						this.plugin.state.baseIncome = n;
						await this.plugin.persist();
					}
				})
			);

		new Setting(containerEl)
			.setName("Base monthly upkeep (gp)")
			.addText((text) =>
				text.setValue(String(this.plugin.state.baseUpkeep)).onChange(async (value) => {
					const n = parseFloat(value);
					if (!isNaN(n) && n >= 0) {
						this.plugin.state.baseUpkeep = n;
						await this.plugin.persist();
					}
				})
			);

		new Setting(containerEl)
			.setName("Starting reserve (gp)")
			.setDesc("Used to calculate the Reserve Ratio. Changing this does not change your current treasury.")
			.addText((text) =>
				text.setValue(String(this.plugin.state.startingReserve)).onChange(async (value) => {
					const n = parseFloat(value);
					if (!isNaN(n) && n >= 0) {
						this.plugin.state.startingReserve = n;
						await this.plugin.persist();
					}
				})
			);

		containerEl.createEl("h3", { text: "Danger Zone" });
		new Setting(containerEl)
			.setName("Reset all tracker data")
			.setDesc("Wipes stats, treasury, laws, and the log back to defaults.")
			.addButton((btn) =>
				btn
					.setButtonText("Reset")
					.setWarning()
					.onClick(async () => {
						if (window.confirm("This will erase all Gladestown tracker data. Continue?")) {
							this.plugin.state = Object.assign({}, DEFAULT_STATE, {
								daysPerCourtTurn: this.plugin.settings.daysPerCourtTurn,
							});
							await this.plugin.persist();
							new Notice("Gladestown tracker reset.");
						}
					})
			);
	}
}

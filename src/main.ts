import { App, Plugin, PluginSettingTab } from "obsidian";

export interface WebdavManagerSettings {}

const DEFAULT_SETTINGS: WebdavManagerSettings = {};

export default class WebdavManagerPlugin extends Plugin {
	settings: WebdavManagerSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new WebdavManagerSettingTab(this.app, this));

		console.log(
			"Webdav Manager loaded, version:",
			this.manifest.version
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class WebdavManagerSettingTab extends PluginSettingTab {
	plugin: WebdavManagerPlugin;

	constructor(app: App, plugin: WebdavManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {}
}

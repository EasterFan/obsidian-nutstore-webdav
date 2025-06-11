import {
	App,
	debounce,
	Debouncer,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import WebDavImageUploaderPlugin from "./main";
import { formatPath, FormatVariables, getFormatVariables } from "./utils";

export interface WebDavImageUploaderSettings {
	// Basic
	url: string;
	username?: string;
	password?: string;
	disableBasicAuth?: boolean;

	// Upload
	enableUpload: boolean;
	format: string;
	includeExtensions: string[];
	uploadedFileOperation: "trash" | "delete" | "none";
}

export const DEFAULT_SETTINGS: WebDavImageUploaderSettings = {
	url: "https://yourdomain.com:8443/dav",
	username: "",
	password: "",
	disableBasicAuth: false,

	enableUpload: true,
	format: "/{{nameext}}",
	includeExtensions: ["jpg", "jpeg", "png", "gif", "svg", "webp"],
	uploadedFileOperation: "delete",
};

export class WebDavImageUploaderSettingTab extends PluginSettingTab {
	plugin: WebDavImageUploaderPlugin;

	saveSettings: Debouncer<[], () => Promise<void>>;

	constructor(app: App, plugin: WebDavImageUploaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;

		this.saveSettings = debounce(
			this.plugin.saveSettings.bind(this.plugin),
			200
		);
	}

	display(): void {
		this.containerEl.empty();

		this.basic();

		this.upload();

		this.commands();
	}

	basic() {
		const { containerEl } = this;

		new Setting(containerEl).setName("Basic").setHeading();

		new Setting(containerEl)
			.setName("Url")
			.setDesc("The URL of the WebDAV server.")
			.addText((text) =>
				text.setValue(this.plugin.settings.url).onChange((value) => {
					if (value.endsWith("/")) {
						value = value.slice(0, -1);
					}
					this.plugin.settings.url = value;
					this.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Username")
			.setDesc("The username for WebDAV authentication.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.username ?? "")
					.onChange((value) => {
						this.plugin.settings.username = value;
						this.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Password")
			.setDesc("The password for WebDAV authentication.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.plugin.settings.password ?? "").onChange(
					(value) => {
						this.plugin.settings.password = value;
						this.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName("Disable basic auth")
			.setDesc(
				"By default, the plugin will intercept the image requests for WebDAV Authentication. " +
					"It may take some rendering mistake when scroll up and down the content for now. " +
					"If you don't need this feature, you can disable it. " +
					"You may need to restart Obsidian for this setting to take effect."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.disableBasicAuth ?? false)
					.onChange((value) => {
						this.plugin.settings.disableBasicAuth = value;
						this.saveSettings();
					})
			);
	}

	upload() {
		const { containerEl } = this;

		new Setting(containerEl).setName("Upload").setHeading();

		new Setting(containerEl)
			.setName("Enable upload on drop/paste")
			.setDesc(
				"Toggle if auto upload is enabled. If enabled, files will be uploaded when dropped or pasted."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableUpload)
					.onChange((value) => {
						this.plugin.settings.enableUpload = value;
						this.saveSettings();
					})
			);

		const now = new Date().getMilliseconds();
		const exampleVars = getFormatVariables(
			new File([""], "test.jpg"),
			this.app.workspace.getActiveFile() ??
				({ basename: "", stat: { ctime: now, mtime: now } } as TFile)
		);
		const formatSetting = new Setting(containerEl)
			.setName("Path format")
			.setDesc("The format for the uploaded file path.")
			.addText((text) => {
				text.setValue(this.plugin.settings.format).onChange((value) => {
					if (!value.startsWith("/")) {
						value = "/" + value;
					}

					this.plugin.settings.format = value;

					const examplePath = formatPath(value, exampleVars);
					formatSetting.setDesc(examplePath);

					this.saveSettings();
				});
			});
		const descriptions: Record<keyof FormatVariables, string> = {
			name: "file basename",
			ext: "file extension (excluding `.`)",
			nameext: "file name with extension",
			mtime: "file last modified time",
			now: "current time",
			notename: "note basename",
			notectime: "note creation time",
			notemtime: "note last modified time",
		};
		containerEl.createEl("h4").textContent =
			"Available variables (case insensitive)";
		containerEl.createSpan().textContent =
			"you can add `{{var}}` to use the variable, and `{{dateVar:format}}` to format the date(with moment.js).";
		const descriptionsEl = containerEl.createEl("ul");
		for (const [key, value] of Object.entries(descriptions)) {
			const li = descriptionsEl.createEl("li");
			li.createEl("strong").textContent = key;
			li.createSpan().textContent = `: ${value}`;
		}

		new Setting(containerEl)
			.setName("Include extensions")
			.setDesc(
				"Include file extensions when uploading,  separated by comma. Only files with these extensions will be uploaded."
			)
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.includeExtensions.join(","))
					.onChange((value) => {
						this.plugin.settings.includeExtensions = value
							.split(",")
							.map((ext) => ext.trim())
							.filter((ext) => ext !== "");
						this.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Uploaded file operation")
			.setDesc(
				"What to do with the local file after it is uploaded to WebDAV."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("delete", "Delete permanently")
					.addOption("trash", "Move to system trash")
					.addOption("none", "Do nothing")
					.setValue(this.plugin.settings.uploadedFileOperation)
					.onChange((value) => {
						this.plugin.settings.uploadedFileOperation =
							value as WebDavImageUploaderSettings["uploadedFileOperation"];
						this.saveSettings();
					})
			);
	}

	commands() {
		const { containerEl } = this;

		new Setting(containerEl).setName("Commands").setHeading();

		const message = document.createElement("span");
		message.textContent =
			"The following oprations may break your vault, please make sure to backup your vault before proceeding.";
		message.style.color = "red";
		const description = new DocumentFragment();
		description.appendChild(message);

		let uploadVaultSetting: Setting;
		let downloadVaultSetting: Setting;

		const warning = new Setting(containerEl)
			.setDesc(description)
			.addButton((button) =>
				button.setButtonText("I understand").onClick(() => {
					warning.clear();
					uploadVaultSetting!.setDisabled(false);
					downloadVaultSetting!.setDisabled(false);
				})
			);

		uploadVaultSetting = new Setting(containerEl)
			.setName("Upload all files")
			.setDesc("Upload all files to WebDAV.")
			.addButton((button) =>
				button
					.setButtonText("Upload")
					.setDisabled(true)
					.onClick(() => this.plugin.uploadVaultFiles())
			);

		downloadVaultSetting = new Setting(containerEl)
			.setName("Download all files")
			.setDesc("Download all files from WebDAV.")
			.addButton((button) =>
				button
					.setButtonText("Download")
					.setDisabled(true)
					.onClick(() => this.plugin.downloadVaultFiles())
			);
	}
}

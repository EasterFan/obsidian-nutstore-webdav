import {
	App,
	debounce,
	Debouncer,
	Notice,
	PluginSettingTab,
	Setting,
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
	uploadedFileOperation: "default" | "delete" | "none";
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

		new Setting(containerEl)
			.setName("Url")
			.setDesc("The URL of the WebDAV server.")
			.addText((text) =>
				text.setValue(this.plugin.settings.url).onChange((value) => {
					value = value.trim();
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
				"By default, the plugin will intercept image requests for WebDAV authentication. " +
					"It may cause some rendering mistakes when scrolling up and down the content. " +
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

		new Setting(containerEl)
			.setName("Test connection")
			.addButton((button) =>
				button.setButtonText("Test").onClick(async () => {
					button.setDisabled(true);
					const error = await this.plugin.uploader.testConnection();
					if (error == null) {
						new Notice("Connection successful!");
					} else {
						new Notice(error);
					}
					button.setDisabled(false);
				})
			);
	}

	upload() {
		const { containerEl } = this;

		new Setting(containerEl).setName("Upload").setHeading();

		new Setting(containerEl)
			.setName("Enable upload on drop/paste")
			.setDesc(
				"Toggle if auto-upload is enabled. If enabled, files will be uploaded when dropped or pasted."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableUpload)
					.onChange((value) => {
						this.plugin.settings.enableUpload = value;
						this.saveSettings();
					})
			);

		const now = Date.now();
		const exampleVars = getFormatVariables(
			new File([""], "test.jpg"),
			this.app.workspace.getActiveFile() ?? {
				basename: "test-note",
				stat: { ctime: now, mtime: now },
			}
		);
		const formatSetting = new Setting(containerEl)
			.setName("Path format")
			.setDesc("The format for the uploaded file path.")
			.addText((text) => {
				text.setValue(this.plugin.settings.format).onChange((value) => {
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
		new Setting(containerEl)
			.setName("Available variables (case-insensitive)")
			.setHeading();
		containerEl.createSpan().textContent =
			"You can add `{{var}}` to use the variable, and `{{dateVar:format}}` to format the date (with Moment.js).";
		const descriptionsEl = containerEl.createEl("ul");
		for (const [key, value] of Object.entries(descriptions)) {
			const li = descriptionsEl.createEl("li");
			li.createEl("strong").textContent = key;
			li.createSpan().textContent = `: ${value}`;
		}

		new Setting(containerEl)
			.setName("Include extensions")
			.setDesc(
				"Include file extensions when uploading, separated by commas. Only files with these extensions will be uploaded."
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
					.addOption(
						"default",
						"Same as 'Files & Links -> Deleted files'"
					)
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

		const message = document.createElement("strong");
		message.textContent =
			"The following operations may break your vault. Please make sure to back up your vault before proceeding.";
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

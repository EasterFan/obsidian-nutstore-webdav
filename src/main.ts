import {
	Editor,
	Menu,
	Notice,
	Platform,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";
import { WebDavClient } from "./webdavClient";
import { createWebDavImageExtension, WebDavImageLoader } from "./imageLoader";
import {
	formatPath,
	getCurrentEditor,
	getFileByPath,
	getFormatVariables,
	getFileType,
	isLocalPath,
	noticeError,
	replaceLink,
	getSelectedImageLink,
	ImageLinkInfo,
} from "./utils";
import {
	DEFAULT_SETTINGS,
	WebDavImageUploaderSettings,
	WebDavImageUploaderSettingTab,
} from "./settings";
import { BatchDownloader, BatchUploader } from "./batch";
import { ConfirmModal } from "./modals/confirmModal";
import { DummyPdf } from "./dummyPdf";

export default class WebDavImageUploaderPlugin extends Plugin {
	settings: WebDavImageUploaderSettings;

	client: WebDavClient;

	loader: WebDavImageLoader;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new WebDavImageUploaderSettingTab(this.app, this));

		this.client = new WebDavClient(this);

		this.loader = new WebDavImageLoader(this);

		this.addCommand({
			id: "toggle-auto-upload",
			name: "Toggle auto upload",
			callback: this.toggleAutoUpload.bind(this),
		});

		// upload file when pasted or dropped
		this.registerEvent(
			this.app.workspace.on("editor-paste", this.onUploadFile.bind(this))
		);
		this.registerEvent(
			this.app.workspace.on("editor-drop", this.onUploadFile.bind(this))
		);

		// register right click menu items when clicking on image link
		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				this.onRightClickLink.bind(this)
			)
		);
		// on mobile platform, obsidian is not trigger `editor-menu` event on right-clicking the url,
		// and trigger `url-menu` event instead
		if (Platform.isMobile) {
			this.registerEvent(
				this.app.workspace.on("url-menu", (menu) =>
					this.onRightClickLink(menu, getCurrentEditor(this.app)!)
				)
			);
		}

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, source) => {
				// obsidian is not trigger `editor-menu` event on mobile platform,
				// and only trigger `link-context-menu` event
				if (Platform.isMobile && source === "link-context-menu") {
					return this.onRightClickLink(
						menu,
						getCurrentEditor(this.app)!
					);
				}

				// register right click menu items in file explorer
				if (source === "file-explorer-context-menu") {
					this.onRightClickExplorer(menu, file);
				}
			})
		);

		// add basic authentication header when loading webdav images
		if (!this.settings.disableBasicAuth) {
			this.registerEditorExtension(createWebDavImageExtension(this));
		}

		console.log(
			"WebDAV Image Uploader loaded, version:",
			this.manifest.version
		);
	}

	onunload() {
		this.loader.destroy();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);

		if (this.client != null) {
			this.client.initClient();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.client.initClient();
	}

	async toggleAutoUpload() {
		this.settings.enableUpload = !this.settings.enableUpload;
		await this.saveSettings();
		new Notice(
			`Auto upload is ${
				this.settings.enableUpload ? "enabled" : "disabled"
			}.`
		);
	}

	async onUploadFile(e: ClipboardEvent | DragEvent, editor: Editor) {
		if (!this.settings.enableUpload) {
			return;
		}

		if (e.defaultPrevented) {
			return;
		}

		let file: File | undefined;
		if (e.type === "paste") {
			file = (e as ClipboardEvent).clipboardData?.files[0];
		} else if (e.type === "drop") {
			file = (e as DragEvent).dataTransfer?.files[0];
		}

		if (file == null) {
			return;
		}

		if (this.isExcludeFile(file.name)) {
			return;
		}

		e.preventDefault();

		const notice = new Notice(`Uploading file: '${file.name}'...`, 0);
		try {
			const activeFile = this.app.workspace.getActiveFile()!;
			const vars = getFormatVariables(file, activeFile);
			const path = formatPath(this.settings.format, vars);
			const data = await this.client.uploadFile(file, path);

			let link;
			if (
				this.settings.enableDummyPdf &&
				getFileType(data.fileName) === "pdf"
			) {
				const file = await DummyPdf.create(this.app, activeFile, data);
				link = file.getLink(this.app);
			} else {
				link = data.toMarkdownLink();
			}

			editor.replaceSelection(link);
		} catch (e) {
			noticeError(`Failed to upload file: '${file.name}', ${e}`);
		}

		notice.hide();
	}

	async onRightClickLink(menu: Menu, editor: Editor) {
		const selectedImageLink = getSelectedImageLink(editor);
		if (selectedImageLink == null) {
			return;
		}

		let isWebdavLink = this.isWebdavUrl(selectedImageLink.path);
		let isLocal = !isWebdavLink && isLocalPath(selectedImageLink.path);

		// assume pdf file is dummy pdf if `enableDummyPdf` is true
		const type = getFileType(selectedImageLink.path);
		if (isLocal && this.settings.enableDummyPdf && type === "pdf") {
			isWebdavLink = true;
			isLocal = false;
		}

		const lineNumber = editor.getCursor().line;

		if (isWebdavLink) {
			menu.addItem((item) =>
				item
					.setTitle("Download file from WebDAV")
					.setIcon("arrow-down-from-line")
					.onClick(() =>
						this.onDownloadFile(
							lineNumber,
							selectedImageLink,
							editor
						)
					)
			);

			menu.addItem((item) =>
				item
					.setTitle("Delete file from WebDAV")
					.setIcon("trash")
					.onClick(() =>
						this.onDeleteFile(lineNumber, selectedImageLink, editor)
					)
			);
		}

		if (isLocal) {
			if (this.isExcludeFile(selectedImageLink.path)) {
				return;
			}

			menu.addItem((item) =>
				item
					.setTitle("Upload file to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() =>
						this.onUploadLocalFile(
							lineNumber,
							selectedImageLink,
							editor
						)
					)
			);
		}
	}

	async onRightClickExplorer(menu: Menu, file: TAbstractFile) {
		const modal = new ConfirmModal(this.app, {
			title: "Warning",
			content:
				"The following operations may break your vault. Please make sure to back up your vault before proceeding, are you sure to continue?",
		});

		if (file instanceof TFile && file.extension === "md") {
			menu.addItem((item) =>
				item
					.setTitle("Upload files in note to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const uploader = new BatchUploader(this);
							await uploader.uploadNoteFiles(file, true);
							await uploader.createLog();
						};
						modal.open();
					})
			);
			menu.addItem((item) =>
				item
					.setTitle("Download files in note from WebDAV")
					.setIcon("arrow-down-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const downloader = new BatchDownloader(this);
							await downloader.downloadNoteFiles(file);
							await downloader.createLog();
						};
						modal.open();
					})
			);
		}

		if (file instanceof TFolder) {
			menu.addItem((item) =>
				item
					.setTitle("Upload attachments to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const uploader = new BatchUploader(this);
							await uploader.uploadAttachments(file);
							await uploader.createLog();
						};
						modal.open();
					})
			);
			menu.addItem((item) =>
				item
					.setTitle("Upload files in folder's notes to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const uploader = new BatchUploader(this);
							await uploader.uploadFolderFiles(file);
							await uploader.createLog();
						};
						modal.open();
					})
			);
			menu.addItem((item) =>
				item
					.setTitle("Download files in folder's notes from WebDAV")
					.setIcon("arrow-down-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const downloader = new BatchDownloader(this);
							await downloader.downloadFolderFiles(file);
							await downloader.createLog();
						};
						modal.open();
					})
			);
		}
	}

	async onDownloadFile(
		lineNumber: number,
		link: ImageLinkInfo,
		editor: Editor
	) {
		const notice = new Notice(`Downloading file '${link.path}'...`, 0);
		try {
			let path;
			const type = getFileType(link.path);
			if (this.settings.enableDummyPdf && type === "pdf") {
				const dummyPdf = new DummyPdf(link.path);
				path = await dummyPdf.getUrl(this.app);
			} else {
				path = link.path;
			}

			const file = await this.client.downloadFile(path);

			let newLink = this.app.fileManager.generateMarkdownLink(
				file,
				file.path
			);

			if (type === "image" && newLink[0] !== "!") {
				newLink = `!${newLink}`;
			}

			if (this.settings.enableDummyPdf && type === "pdf") {
				const dummyPdf = new DummyPdf(link.path);
				await dummyPdf.delete(this.app);
			}

			replaceLink(editor, lineNumber, link, newLink);
		} catch (e) {
			noticeError(`Failed to download '${link.path}', ${e}`);
		}

		notice.hide();
	}

	async onUploadLocalFile(
		lineNumber: number,
		link: ImageLinkInfo,
		editor: Editor
	) {
		const tFile = getFileByPath(this.app, link.path);
		if (tFile == null) {
			new Notice(`'${link.path}' not found.`);
			return;
		}

		const notice = new Notice(`Uploading file '${tFile.name}'...`, 0);
		try {
			const buffer = await this.app.vault.readBinary(tFile);
			const file = new File([buffer], tFile.name, {
				lastModified: tFile.stat.mtime,
			});

			const vars = getFormatVariables(
				file,
				this.app.workspace.getActiveFile()!
			);
			const path = formatPath(this.settings.format, vars);

			const data = await this.client.uploadFile(file, path);

			await this.deleteLocalFile(tFile);

			const newLink = data.toMarkdownLink();
			replaceLink(editor, lineNumber, link, newLink);

			new Notice(`File '${tFile.name}' uploaded successfully`);
		} catch (e) {
			noticeError(`Failed to upload file '${tFile.name}', ${e}`);
		}

		notice.hide();
	}

	async onDeleteFile(
		lineNumber: number,
		link: ImageLinkInfo,
		editor: Editor
	) {
		const notice = new Notice(`Deleting file '${link.path}'...`, 0);
		try {
			await this.client.deleteFile(link.path);
			replaceLink(editor, lineNumber, link);
		} catch (e) {
			noticeError(`Failed to delete file '${link.path}', ${e}`);
		}

		notice.hide();
	}

	async deleteLocalFile(file: TFile) {
		const operation = this.settings.uploadedFileOperation;
		if (operation === "default") {
			await this.app.fileManager.trashFile(file);
		} else if (operation === "delete") {
			await this.app.vault.delete(file);
		}
	}

	isWebdavUrl(url: string) {
		return url.startsWith(this.settings.url);
	}

	isExcludeFile(path: string) {
		const extension = path.split(".").pop()?.toLowerCase();
		if (extension == null) {
			return false;
		}
		return !this.settings.includeExtensions.includes(extension);
	}
}

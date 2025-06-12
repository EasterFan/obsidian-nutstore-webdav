import { Editor, Menu, Notice, Plugin, TFile } from "obsidian";
import { WebDavImageUploader } from "./uploader";
import { createWebDavImageExtension, WebDavImageLoader } from "./imageLoader";
import {
	formatPath,
	getFileByPath,
	getFormatVariables,
	getSelectedImageLink,
	ImageLinkInfo,
	isLocalPath,
	matchImageLinks,
	noticeError,
	replaceLink,
} from "./utils";
import {
	DEFAULT_SETTINGS,
	WebDavImageUploaderSettings,
	WebDavImageUploaderSettingTab,
} from "./settings";

export default class WebDavImageUploaderPlugin extends Plugin {
	settings: WebDavImageUploaderSettings;

	uploader: WebDavImageUploader;

	loader: WebDavImageLoader;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new WebDavImageUploaderSettingTab(this.app, this));

		this.uploader = new WebDavImageUploader(this);

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

		if (this.uploader != null) {
			this.uploader.initClient();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.uploader.initClient();
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
			const data = await this.uploader.uploadFile(file, path);

			const link = data.toMarkdownLink();
			editor.replaceSelection(link);
		} catch (e) {
			noticeError(`Failed to upload file: '${file.name}', ${e}`);
		}

		notice.hide();
	}

	async onRightClickLink(menu: Menu, editor: Editor) {
		const selectedImage = getSelectedImageLink(editor);
		if (selectedImage == null) {
			return;
		}

		const isWebdavLink = this.isWebdavUrl(selectedImage.path);
		const isLocalImage = !isWebdavLink && isLocalPath(selectedImage.path);

		const lineNumber = editor.getCursor().line;

		if (isWebdavLink) {
			menu.addItem((item) =>
				item
					.setTitle("Download file from WebDAV")
					.setIcon("arrow-down-from-line")
					.onClick(() =>
						this.onDownloadFile(lineNumber, selectedImage, editor)
					)
			);

			menu.addItem((item) =>
				item
					.setTitle("Delete file from WebDAV")
					.setIcon("trash")
					.onClick(() =>
						this.onDeleteFile(lineNumber, selectedImage, editor)
					)
			);
		}

		if (isLocalImage) {
			if (this.isExcludeFile(selectedImage.path)) {
				return;
			}

			menu.addItem((item) =>
				item
					.setTitle("Upload file to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() =>
						this.onUploadLocalFile(
							lineNumber,
							selectedImage,
							editor
						)
					)
			);
		}
	}

	async onDownloadFile(
		lineNumber: number,
		link: ImageLinkInfo,
		editor: Editor
	) {
		const notice = new Notice(`Downloading file '${link.path}'...`);
		try {
			const file = await this.uploader.downloadFile(link.path);

			const newLink = this.app.fileManager.generateMarkdownLink(
				file,
				file.path
			);

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

			const data = await this.uploader.uploadFile(file, path);
			const newLink = data.toMarkdownLink();
			replaceLink(editor, lineNumber, link, newLink);

			await this.deleteLocalFile(tFile);

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
			await this.uploader.deleteFile(link.path);
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

	async uploadVaultFiles() {
		const notes = this.app.vault.getMarkdownFiles();

		const notice = new Notice("", 0);

		let count = 1;
		const total = notes.length;
		for (const note of notes) {
			notice.setMessage(
				`Uploading '${note.path}''s files\n${count++}/${total}...`
			);

			try {
				await this.uploadNoteFiles(note);
			} catch (e) {
				noticeError(`Failed to upload files from '${note.path}', ${e}`);
			}
		}

		new Notice(`All files uploaded finished.`);

		notice.hide();
	}

	async uploadNoteFiles(note: TFile) {
		const content = await this.app.vault.read(note);
		const links = matchImageLinks(content).filter(
			(link) => !this.isExcludeFile(link.path) && isLocalPath(link.path)
		);
		if (links.length === 0) {
			return;
		}

		let newContent = content;
		for (const link of links) {
			try {
				const tFile = getFileByPath(this.app, link.path);
				if (tFile == null) {
					console.warn(`File '${link.path}' not found in vault.`);
					continue;
				}

				const buffer = await this.app.vault.readBinary(tFile);
				const file = new File([buffer], tFile.name, {
					lastModified: tFile.stat.mtime,
				});

				const vars = getFormatVariables(file, tFile);
				const path = formatPath(this.settings.format, vars);

				const data = await this.uploader.uploadFile(file, path);
				const newLink = data.toMarkdownLink();
				newContent =
					newContent.substring(0, link.start) +
					newLink +
					newContent.substring(link.end);
			} catch (e) {
				noticeError(
					`Failed to upload file '${link.path}' from ${note.path}, ${e}`
				);
			}
		}

		if (content !== newContent) {
			await this.app.vault.modify(note, newContent, {
				ctime: note.stat.ctime,
				mtime: note.stat.mtime,
			});
		}
	}

	async downloadVaultFiles() {
		const notes = this.app.vault.getMarkdownFiles();

		const notice = new Notice("", 0);

		let count = 1;
		const total = notes.length;
		for (const note of notes) {
			notice.setMessage(
				`Downloading '${note.path}''s files\n${count++}/${total}...`
			);

			try {
				await this.downloadNoteFiles(note);
			} catch (e) {
				noticeError(`Failed to upload files from '${note.path}', ${e}`);
			}
		}

		new Notice(`All files downloaded finished.`);

		notice.hide();
	}

	async downloadNoteFiles(note: TFile) {
		const content = await this.app.vault.read(note);
		const links = matchImageLinks(content).filter(
			(link) =>
				!this.isExcludeFile(link.path) && this.isWebdavUrl(link.path)
		);
		if (links.length === 0) {
			return;
		}

		let newContent = content;
		for (const link of links) {
			try {
				const file = await this.uploader.downloadFile(
					link.path,
					note.path
				);

				const newLink = this.app.fileManager.generateMarkdownLink(
					file,
					file.path
				);

				newContent =
					newContent.substring(0, link.start) +
					newLink +
					newContent.substring(link.end);
			} catch (e) {
				noticeError(
					`Failed to download file '${link.path}' from ${note.path}, ${e}`
				);
			}
		}

		if (content !== newContent) {
			await this.app.vault.modify(note, newContent, {
				ctime: note.stat.ctime,
				mtime: note.stat.mtime,
			});
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

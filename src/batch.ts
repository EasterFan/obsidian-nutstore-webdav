import { Notice, TFile, TFolder } from "obsidian";
import {
	formatPath,
	getFileByPath,
	getFormatVariables,
	ImageLinkInfo,
	isLocalPath,
	matchImageLinks,
	noticeError,
} from "./utils";
import WebDavImageUploaderPlugin from "./main";

export class BatchUploader {
	plugin: WebDavImageUploaderPlugin;

	result: BatchProcessFileResult[] = [];

	constructor(plugin: WebDavImageUploaderPlugin) {
		this.plugin = plugin;
	}

	async uploadVaultFiles() {
		this.uploadFolderFiles();
	}

	async uploadFolderFiles(folder?: TFolder) {
		const notes =
			folder == null
				? this.plugin.app.vault.getMarkdownFiles()
				: getMarkdownFilesInFolder(folder);

		const notice = new Notice("", 0);

		let count = 1;
		const total = notes.length;
		for (const note of notes) {
			notice.setMessage(
				`Uploading files in '${note.path}'\n${count++}/${total}...`
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
		const content = await this.plugin.app.vault.read(note);
		const links = matchImageLinks(content).filter(
			(link) =>
				!this.plugin.isExcludeFile(link.path) && isLocalPath(link.path)
		);
		const total = links.length;
		if (total === 0) {
			return;
		}

		const notice = new Notice("", 0);

		let count = 0;
		let newContent = content;
		for (const link of links) {
			count += 1;

			try {
				const tFile = getFileByPath(this.plugin.app, link.path);
				if (tFile == null) {
					const message = `File '${link.path}' not found in vault.`;
					this.result.push({
						success: false,
						message,
						note,
						link: link,
					});
					console.warn(message);
					continue;
				}

				notice.setMessage(
					`Uploading '${tFile.path}'\n${count}/${total}...`
				);

				const buffer = await this.plugin.app.vault.readBinary(tFile);
				const file = new File([buffer], tFile.name, {
					lastModified: tFile.stat.mtime,
				});

				const vars = getFormatVariables(file, tFile);
				const path = formatPath(this.plugin.settings.format, vars);

				const data = await this.plugin.client.uploadFile(file, path);
				const newLink = data.toMarkdownLink();

				await this.plugin.deleteLocalFile(tFile);

				newContent =
					newContent.substring(0, link.start) +
					newLink +
					newContent.substring(link.end);
				this.result.push({
					success: true,
					note,
					link: link,
				});
			} catch (e) {
				const message = `Failed to upload file '${link.path}' from ${note.path}, ${e}`;
				this.result.push({
					success: false,
					message,
					note,
					link: link,
				});
				noticeError(message);
			}
		}

		if (content !== newContent) {
			await this.plugin.app.vault.modify(note, newContent, note.stat);
		}

		notice.hide();
	}
}

export class BatchDownloader {
	plugin: WebDavImageUploaderPlugin;

	result: BatchProcessFileResult[] = [];

	constructor(plugin: WebDavImageUploaderPlugin) {
		this.plugin = plugin;
	}
	async downloadVaultFiles() {
		this.downloadFolderFiles();
	}

	async downloadFolderFiles(folder?: TFolder) {
		const notes =
			folder == null
				? this.plugin.app.vault.getMarkdownFiles()
				: getMarkdownFilesInFolder(folder);

		const notice = new Notice("", 0);

		let count = 1;
		const total = notes.length;
		for (const note of notes) {
			notice.setMessage(
				`Downloading files in '${note.path}'\n${count++}/${total}...`
			);

			try {
				await this.downloadNoteFiles(note);
			} catch (e) {
				noticeError(
					`Failed to download files from '${note.path}', ${e}`
				);
			}
		}

		new Notice(`All files downloaded finished.`);

		notice.hide();
	}

	async downloadNoteFiles(note: TFile) {
		const content = await this.plugin.app.vault.read(note);
		const links = matchImageLinks(content).filter(
			(link) =>
				!this.plugin.isExcludeFile(link.path) &&
				this.plugin.isWebdavUrl(link.path)
		);
		const total = links.length;
		if (total === 0) {
			return;
		}

		const notice = new Notice("", 0);

		let count = 1;
		let newContent = content;
		for (const link of links) {
			try {
				notice.setMessage(
					`Downloading '${link.path}'\n${count++}/${total}...`
				);

				const file = await this.plugin.client.downloadFile(
					link.path,
					note.path
				);

				const newLink =
					this.plugin.app.fileManager.generateMarkdownLink(
						file,
						file.path
					);

				newContent =
					newContent.substring(0, link.start) +
					newLink +
					newContent.substring(link.end);

				this.result.push({
					success: true,
					note,
					link: link,
				});
			} catch (e) {
				const message = `Failed to download file '${link.path}' from ${note.path}, ${e}`;
				this.result.push({
					success: false,
					message,
					note,
					link: link,
				});
				noticeError(message);
			}
		}

		if (content !== newContent) {
			await this.plugin.app.vault.modify(note, newContent, note.stat);
		}

		notice.hide();
	}
}

function getMarkdownFilesInFolder(folder: TFolder) {
	const files: TFile[] = [];
	for (const item of folder.children) {
		if (item instanceof TFile && item.extension === "md") {
			files.push(item);
		} else if (item instanceof TFolder) {
			files.push(...getMarkdownFilesInFolder(item));
		}
	}
	return files;
}

export interface BatchProcessFileResult {
	success: boolean;

	message?: string;

	note: TFile;

	link: ImageLinkInfo;
}

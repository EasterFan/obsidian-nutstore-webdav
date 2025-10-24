import { App, TFile } from "obsidian";
import { FileInfo } from "./webdavClient";
import { getFileByPath } from "./utils";

export class DummyPdf {
	path: string;

	private file: TFile | null;

	private url: string | null;

	constructor(path: string) {
		this.path = path;
	}

	static async create(app: App, note: TFile, fileInfo: FileInfo) {
		const filePath = await app.fileManager.getAvailablePathForAttachment(
			fileInfo.fileName,
			note.path
		);
		const file = await app.vault.create(filePath, fileInfo.url);
		const result = new DummyPdf(filePath);
		result.file = file;
		result.url = fileInfo.url;
		return result;
	}

	getLink(app: App) {
		let link = app.fileManager.generateMarkdownLink(
			this.getFile(app),
			this.path
		);
		if (link[0] !== "!") {
			link = "!" + link;
		}
		return link;
	}

	getFile(app: App) {
		if (this.file == null) {
			this.file = getFileByPath(app, this.path);
			if (this.file == null) {
				throw new Error(`File not found: '${this.path}'`);
			}
		}
		return this.file;
	}

	async getUrl(app: App) {
		if (this.url != null) {
			return this.url;
		}

		const file = this.getFile(app);
		this.url = await app.vault.read(file);
		return this.url;
	}

	async delete(app: App) {
		const file = this.getFile(app);
		await app.vault.delete(file);
	}
}

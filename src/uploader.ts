import { WebDAVClient, createWebDAVClient } from "./webdav-client";
import WebDavImageUploaderPlugin from "./main";

export class WebDavImageUploader {
	plugin: WebDavImageUploaderPlugin;
	client: WebDAVClient;

	constructor(plugin: WebDavImageUploaderPlugin) {
		this.plugin = plugin;

		this.initClient();
	}

	initClient() {
		const settings = this.plugin.settings;
		this.client = createWebDAVClient(settings.url, {
			username: settings.username,
			password: settings.password,
		});
	}

	async downloadFile(url: string, sourcePath?: string) {
		const path = this.getPath(url);
		const fileName = path.split("/").pop()!;

		const resp = await this.client.getFileContents(path);

		const filePath =
			await this.plugin.app.fileManager.getAvailablePathForAttachment(
				fileName,
				sourcePath
			);
		return await this.plugin.app.vault.createBinary(filePath, resp);
	}

	async uploadFile(file: File, path: string): Promise<FileInfo> {
		const buffer = await file.arrayBuffer();

		const success = await this.client.putFileContents(path, buffer);

		if (!success) {
			throw new Error(`Failed to upload file: '${file.name}'`);
		}

		return new FileInfo(file.name, this.getUrl(path));
	}

	async testConnection() {
		try {
			const resp = await this.client.customRequest("/", {
				method: "PROPFIND",
				headers: { Depth: "0" },
			});

			// WebDAV servers may return 207 (Multi-Status) for a successful PROPFIND request
			if (resp.status === 207) {
				return null;
			}

			return `Check connection failed: ${resp.status}`;
		} catch (e) {
			return `${e}`;
		}
	}

	async deleteFile(url: string) {
		const path = this.getPath(url);
		await this.client.deleteFile(path);
	}

	getUrl(path: string) {
		return encodeURI(this.plugin.settings.url + path);
	}

	getPath(url: string) {
		return decodeURI(url.replace(this.plugin.settings.url, ""));
	}
}

export class FileInfo {
	fileName: string;
	url: string;

	constructor(fileName: string, url: string) {
		this.fileName = fileName;
		this.url = url;
	}

	toMarkdownLink(): string {
		// 判断是否为图片文件类型
		const imageExtensions = [
			"jpg",
			"jpeg",
			"png",
			"gif",
			"svg",
			"webp",
			"bmp",
			"ico",
		];
		const fileExtension =
			this.fileName.split(".").pop()?.toLowerCase() || "";
		const isImage = imageExtensions.includes(fileExtension);

		// 图片文件使用 ![](url) 格式，非图片文件使用 [](url) 格式
		return isImage
			? `![${this.fileName}](${this.url})`
			: `[${this.fileName}](${this.url})`;
	}
}

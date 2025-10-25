import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import WebDavImageUploaderPlugin from "./main";
import { getToken, getFileType } from "./utils";

export class WebDavClient {
	plugin: WebDavImageUploaderPlugin;
	client: WebDavClientInner;

	constructor(plugin: WebDavImageUploaderPlugin) {
		this.plugin = plugin;

		this.initClient();
	}

	initClient() {
		const settings = this.plugin.settings;
		this.client = new WebDavClientInner(
			settings.url,
			settings.username,
			settings.password
		);
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

		return { fileName: file.name, url: this.getUrl(path) };
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

export interface FileInfo {
	fileName: string;
	url: string;
}

/**
 * refer to: https://github.com/perry-mitchell/webdav-client
 */
class WebDavClientInner {
	private baseUrl: string;
	private authHeader: string;

	constructor(url: string, username?: string, password?: string) {
		this.baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;

		if (username && password) {
			const credentials = getToken(username, password);
			this.authHeader = `Basic ${credentials}`;
		} else {
			this.authHeader = "";
		}
	}

	async putFileContents(path: string, data: ArrayBuffer | string) {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		try {
			const response = await this.request({
				url,
				method: "PUT",
				headers: { "Content-Type": "application/octet-stream" },
				body: data,
			});
			this.handleResponseCode(response);
		} catch (e) {
			// parent directory not exists
			if (e.message.includes("409")) {
				await this.ensureDirectoryExists(
					path.substring(0, path.lastIndexOf("/"))
				);

				await this.putFileContents(path, data);
			} else {
				throw e;
			}
		}

		return true;
	}

	async getFileContents(path: string) {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		const response = await this.request({
			url,
			method: "GET",
		});

		this.handleResponseCode(response);

		return response.arrayBuffer;
	}

	async deleteFile(path: string) {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		const response = await this.request({
			url,
			method: "DELETE",
		});

		this.handleResponseCode(response);
	}

	async createDirectory(path: string): Promise<void> {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		const response = await this.request({
			url,
			method: "MKCOL",
		});

		this.handleResponseCode(response);
	}

	async ensureDirectoryExists(path: string): Promise<void> {
		const directories = path.split("/").filter((dir) => dir !== "");
		let currentPath = "";

		for (const dir of directories) {
			currentPath += "/" + dir;
			try {
				await this.createDirectory(currentPath);
			} catch (e) {
				if (e.message.includes("405") || e.message.includes("409")) {
					// most webdav servers return 405/409 if the directory already exists
					console.warn(
						`Directory already exists or cannot be created: ${currentPath}`
					);
				} else {
					throw e;
				}
			}
		}
	}

	async customRequest(
		path: string,
		options: {
			method: string;
			headers?: Record<string, string>;
			body?: ArrayBuffer | string;
		}
	) {
		const { method, headers = {}, body } = options;

		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		const response = await this.request({
			url,
			method,
			headers,
			body,
		});

		this.handleResponseCode(response);
		return response;
	}

	private buildUrl(path: string) {
		if (!path.startsWith("/")) {
			path = "/" + path;
		}
		return this.baseUrl + path;
	}

	private encodePath(path: string) {
		return path
			.split("/")
			.map((segment) => encodeURIComponent(segment))
			.join("/");
	}

	private async request(options: {
		url: string;
		method: string;
		headers?: Record<string, string>;
		body?: ArrayBuffer | string;
	}) {
		const { url, method, headers = {}, body } = options;

		const requestOptions: RequestUrlParam = {
			url,
			method: method as any,
			headers: {
				Authorization: this.authHeader,
				...headers,
			},
			body: body,
		};

		return await requestUrl(requestOptions);
	}

	private handleResponseCode(response: RequestUrlResponse) {
		if (response.status >= 400) {
			throw new Error(
				`WebDAV request failed: ${response.status} ${
					response.text ?? "Unknown error"
				}`
			);
		}
	}
}

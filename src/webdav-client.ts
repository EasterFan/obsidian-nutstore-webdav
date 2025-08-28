import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

/**
 * refer to: https://github.com/perry-mitchell/webdav-client
 */
export class WebDAVClient {
	private baseUrl: string;
	private username: string;
	private password: string;
	private authHeader: string;

	constructor(url: string, username?: string, password?: string) {
		this.baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;
		this.username = username ?? "";
		this.password = password ?? "";

		if (this.username && this.password) {
			const credentials = btoa(`${this.username}:${this.password}`);
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

			return true;
		} catch (error) {
			throw error;
		}
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

export function createWebDAVClient(
	url: string,
	options: {
		username?: string;
		password?: string;
	} = {}
) {
	return new WebDAVClient(url, options.username, options.password);
}

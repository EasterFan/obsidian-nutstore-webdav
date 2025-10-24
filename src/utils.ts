import {
	App,
	Editor,
	MarkdownView,
	Notice,
	TFile,
	moment,
	normalizePath,
} from "obsidian";
import { FileInfo } from "./webdavClient";
import { arrayBuffer } from "stream/consumers";

// replace {{ key }} and {{ key:format }} with variables
export function formatPath(
	path: string,
	variables: ReturnType<typeof getFormatVariables>
) {
	const regex = /\{\{\s*(\w+)(?::([^}]+))?\s*\}\}/g;
	const result = path.replace(regex, (match, key, format) => {
		const varKey = key.toLowerCase() as keyof typeof variables;
		const value = variables[varKey];
		if (value == null) {
			return match;
		}

		if (value.type === "string") {
			return value.value as string;
		}

		if (value.type === "date") {
			format = format ?? "YYYY-MM-DD HH:mm:ss";
			return value.value.format(format);
		}

		return match;
	});

	// normallizePath() is always contains no leading `/`
	return "/" + normalizePath(result);
}

export interface NoteInfo {
	basename: string;
	stat: {
		ctime: number;
		mtime: number;
	};
}

export function getFormatVariables(file: File, note: NoteInfo) {
	const [fileName, fileExtension] = file.name.split(".");
	return {
		name: { type: "string", value: fileName },
		ext: { type: "string", value: fileExtension },
		nameext: { type: "string", value: file.name },
		mtime: { type: "date", value: moment(new Date(file.lastModified)) },
		now: { type: "date", value: moment() },
		notename: { type: "string", value: note.basename },
		notectime: { type: "date", value: moment(new Date(note.stat.ctime)) },
		notemtime: { type: "date", value: moment(new Date(note.stat.mtime)) },
	};
}

export type FormatVariables = ReturnType<typeof getFormatVariables>;

export function replaceLink(
	editor: Editor,
	lineNumber: number,
	link: ImageLinkInfo,
	newLink?: string
) {
	const line = editor.getLine(lineNumber);
	const newLine =
		line.substring(0, link.start) +
		(newLink ?? "") +
		line.substring(link.end);
	editor.setLine(lineNumber, newLine);
}

export function getFileByPath(app: App, path: string) {
	path = decodeURI(path);
	// https://forum.obsidian.md/t/how-to-get-full-paths-from-link-text
	return app.metadataCache.getFirstLinkpathDest(path, "");
}

// get image link currently selected
export function getSelectedImageLink(editor: Editor) {
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const links = matchImageLinks(line);
	return links.find(
		(link) => link.start <= cursor.ch && link.end >= cursor.ch
	);
}

// get all image links in line
export function matchImageLinks(line: string): ImageLinkInfo[] {
	// !?[$1]($2)|!?[[$3|$4]] - markdown or wikilink
	const regex =
		/(?:!?\[(.*?)\]\((.*?)\))|(?:!?\[\[([^|\]]+?)(?:\|(.*?))?\]\])/g;
	const matches = line.matchAll(regex);
	return (
		Array.from(matches)
			.map((match) => {
				let name: string;
				let path: string;

				if (match[3] != null) {
					path = match[3];
					name = match[4] ?? "";
				} else {
					name = match[1] ?? "";
					path = match[2];
				}

				return {
					start: match.index!,
					end: match.index! + match[0].length,
					raw: match[0],
					name: name,
					path: path,
				};
			})
			// reverse the order as replacing links from back to front is more convenient
			.reverse()
	);
}

export interface ImageLinkInfo {
	start: number;
	end: number;
	name: string;
	path: string;
	raw: string;
}

export function isLocalPath(path: string) {
	return !path.startsWith("http://") && !path.startsWith("https://");
}

export function noticeError(message: string, ...args: any[]) {
	console.error(message, ...args);
	new Notice(message, 5000);
}

export function getToken(username?: string, password?: string) {
	return btoa(unescape(encodeURIComponent(`${username}:${password}`)));
}

export function getCurrentEditor(app: App) {
	return app.workspace.getActiveViewOfType(MarkdownView)?.editor;
}

export function getFileType(fileName: string) {
	const index = fileName.lastIndexOf(".");
	if (index === -1) {
		return "attachment";
	}

	const fileExtension = fileName.substring(index + 1);
	if (fileExtension === "md") {
		return "md";
	}

	if (fileExtension === "pdf") {
		return "pdf";
	}

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
	if (imageExtensions.includes(fileExtension)) {
		return "image";
	}

	return "attachment";
}

export async function createDummyPdf(
	app: App,
	note: TFile,
	fileInfo: FileInfo
) {
	const filePath = await app.fileManager.getAvailablePathForAttachment(
		fileInfo.fileName,
		note.path
	);
	const file = await app.vault.create(filePath, fileInfo.url);
	let link = app.fileManager.generateMarkdownLink(file, filePath);
	if (link[0] !== "!") {
		link = "!" + link;
	}
	return link;
}

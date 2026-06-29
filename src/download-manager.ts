import { EventEmitter } from "events";
import {
	VideoInfo,
	DownloadOptions,
	DownloadProgress,
} from "./types";
import { parseProgress, sanitizeFilename } from "./utils";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";

interface YtDlpRawInfo {
	[key: string]: unknown;
	id?: string;
	title?: string;
	description?: string;
	thumbnail?: string;
	thumbnails?: Array<{ url: string }>;
	duration?: number;
	channel?: string;
	uploader?: string;
	upload_date?: string;
	view_count?: number;
	like_count?: number;
	formats?: Array<Record<string, unknown>>;
	webpage_url?: string;
	filesize_approx?: number;
	_type?: string;
	entries?: YtDlpRawEntry[];
}

interface YtDlpRawEntry {
	[key: string]: unknown;
	id?: string;
	title?: string;
	thumbnail?: string;
	thumbnails?: Array<{ url: string }>;
	duration?: number;
	channel?: string;
	uploader?: string;
}

export class DownloadManager extends EventEmitter {
	private pluginDir: string;
	private settingsGetter: () => import("./types").PluginSettings;
	private currentProcess: ReturnType<typeof spawn> | null = null;
	private _isDownloading = false;
	lastVideoInfo: import("./types").VideoInfo | null = null;

	constructor(pluginDir: string, settingsGetter: () => import("./types").PluginSettings) {
		super();
		this.pluginDir = pluginDir;
		this.settingsGetter = settingsGetter;
	}

	get isDownloading(): boolean {
		return this._isDownloading;
	}

	/**
	 * Get video metadata using yt-dlp --dump-json
	 */
	async getVideoInfo(url: string): Promise<VideoInfo> {
		return new Promise((resolve, reject) => {

			const settings = this.settingsGetter();
			const isWin = process.platform === "win32";
			const ytDlpPath = path.join(this.pluginDir, "bin", isWin ? "yt-dlp.exe" : "yt-dlp");

			if (!fs.existsSync(ytDlpPath)) {
				return reject(new Error(`Файл yt-dlp не найден по пути: ${ytDlpPath}. Поместите его туда.`));
			}

			const args = [
				"--dump-single-json",
				"--flat-playlist",
				"--no-warnings",
			];

			if (settings.impersonateBrowser) {
				args.push("--impersonate", "chrome");
			}

			args.push(url);

			const proc = spawn(ytDlpPath, args);

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on("close", (code: number) => {
				if (code !== 0) {
					reject(
						new Error(
							`yt-dlp exited with code ${code}: ${stderr.trim()}`
						)
					);
					return;
				}

				try {
					const info = JSON.parse(stdout.trim()) as YtDlpRawInfo;
					const isPlaylist = info._type === "playlist" || Array.isArray(info.entries);
					const videoInfo: VideoInfo = {
						id: info.id || "",
						title: info.title || "Unknown",
						description: info.description || "",
						thumbnail:
							info.thumbnail ||
							(info.thumbnails &&
							info.thumbnails.length > 0
								? info.thumbnails[
										info.thumbnails.length - 1
									].url
								: ""),
						duration: info.duration || 0,
						channel: info.channel || info.uploader || "Unknown",
						upload_date: info.upload_date || "",
						view_count: info.view_count || 0,
						like_count: info.like_count || 0,
						formats: (info.formats || []).map(
							(f: Record<string, unknown>) => ({
								format_id: f.format_id || "",
								format_note: f.format_note || "",
								ext: f.ext || "",
								resolution: f.resolution || "",
								filesize: f.filesize || f.filesize_approx || null,
								vcodec: f.vcodec || "none",
								acodec: f.acodec || "none",
								height: f.height || null,
								width: f.width || null,
								tbr: f.tbr || null,
							})
						),
						webpage_url: info.webpage_url || url,
						filesize_approx: info.filesize_approx || undefined,
						isPlaylist: isPlaylist,
						playlistCount: isPlaylist && info.entries ? info.entries.length : undefined,
						entries: isPlaylist && info.entries ? info.entries.map((e: YtDlpRawEntry) => ({
							id: e.id || "",
							title: e.title || "Unknown",
							thumbnail: e.thumbnail || (e.thumbnails && e.thumbnails.length > 0 ? e.thumbnails[e.thumbnails.length - 1].url : ""),
							duration: e.duration || 0,
							channel: e.uploader || e.channel || info.uploader || info.channel || "Unknown"
						})) : undefined,
					};
					this.lastVideoInfo = videoInfo;
					resolve(videoInfo);
				} catch (e) {
					reject(
						new Error(
							`Failed to parse video info: ${e instanceof Error ? e.message : String(e)}`
						)
					);
				}
			});

			proc.on("error", (err: Error) => {
				reject(
					new Error(
						`Failed to run yt-dlp: ${err.message}`
					)
				);
			});
		});
	}

	/**
	 * Download video or audio
	 */
	async download(options: DownloadOptions): Promise<string> {
		if (this._isDownloading) {
			throw new Error("A download is already in progress");
		}

		this._isDownloading = true;
		this.emit("start", options);

		return new Promise((resolve, reject) => {
			this._isDownloading = true;
			this.emit("status", "Инициализация...");


			const settings = this.settingsGetter();
			
			const isWin = process.platform === "win32";
			const ytDlpPath = path.join(this.pluginDir, "bin", isWin ? "yt-dlp.exe" : "yt-dlp");
			const ffmpegPath = path.join(this.pluginDir, "bin", isWin ? "ffmpeg.exe" : "ffmpeg");

			if (!fs.existsSync(ytDlpPath) || !fs.existsSync(ffmpegPath)) {
				this._isDownloading = false;
				return reject(new Error(`Файлы yt-dlp или ffmpeg не найдены в папке: ${path.join(this.pluginDir, "bin")}. Поместите их туда.`));
			}

			const args: string[] = [
				"--newline",
				"--no-warnings",
				"--ffmpeg-location",
				ffmpegPath, // Let yt-dlp determine how to use the ffmpeg path or command
			];
			
			if (!options.isPlaylist) {
				args.push("--no-playlist");
			} else {
				args.push("--yes-playlist");
				if (options.playlistItems && options.playlistItems.length > 0) {
					args.push("--playlist-items", options.playlistItems.join(","));
				}
			}

			if (settings.impersonateBrowser) {
				args.push("--impersonate", "chrome");
			}

			// Output template
			let filename = options.filename
				? sanitizeFilename(options.filename)
				: "%(title)s.%(ext)s";
			
			if (options.isPlaylist) {
				filename = "%(playlist_index)s - " + filename;
			}
				
			const outputTemplate = path.join(options.outputPath, filename);
			args.push("-o", outputTemplate);

			args.push("--postprocessor-args", "ffmpeg:-threads 0");

			if (options.type === "audio") {
				// Audio-only download
				let preferExt = "";
				if (options.audioFormat === "m4a") preferExt = "[ext=m4a]";
				else if (options.audioFormat === "opus") preferExt = "[ext=webm]";

				args.push("-f", `bestaudio${preferExt}/bestaudio/best`); // Prefer requested native format
				args.push("-x");
				
				// yt-dlp expects 'vorbis' instead of 'ogg'
				const ytDlpAudioFormat = options.audioFormat === "ogg" ? "vorbis" : options.audioFormat;
				args.push("--audio-format", ytDlpAudioFormat);
				args.push("--audio-quality", "0"); // Best quality
			} else {
				// Video download
				const quality = options.videoQuality === "best"
					? ""
					: `[height<=${options.videoQuality}]`;

				switch (options.videoFormat) {
					case "mp4":
						args.push(
							"-f",
							`bestvideo${quality}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${quality}+bestaudio/best${quality}[ext=mp4]/best${quality}`
						);
						args.push("--merge-output-format", "mp4");
						break;
					case "webm":
						args.push(
							"-f",
							`bestvideo${quality}[ext=webm]+bestaudio[ext=webm]/bestvideo${quality}+bestaudio/best${quality}`
						);
						args.push("--merge-output-format", "webm");
						break;
					case "mkv":
						args.push(
							"-f",
							`bestvideo${quality}+bestaudio/best${quality}`
						);
						args.push("--merge-output-format", "mkv");
						break;
				}
			}

			args.push(options.url);

			const proc = spawn(ytDlpPath, args);
			this.currentProcess = proc;

			let lastFilename = "";
			let stderr = "";
			let currentPlaylistIndex: number | undefined;
			let totalPlaylistCount: number | undefined;

			proc.stdout.on("data", (data: Buffer) => {
				const lines = data.toString().split("\n");
				for (const line of lines) {
					if (!line.trim()) continue;

					// Check for playlist progress
					const playlistMatch = line.match(/\[download\] Downloading video (\d+) of (\d+)/);
					if (playlistMatch) {
						currentPlaylistIndex = parseInt(playlistMatch[1], 10);
						totalPlaylistCount = parseInt(playlistMatch[2], 10);
					}

					// Check for destination filename
					const destMatch = line.match(
						/\[(?:download|Merger|ExtractAudio)\].*?(?:Destination|Merging formats into|Converting).*?"?([^"\n]+)"?/
					);
					if (destMatch) {
						lastFilename = destMatch[1].trim().replace(/^"|"$/g, "");
					}

					// Also capture simple destination lines
					const simpleDestMatch = line.match(
						/\[download\] Destination: (.+)/
					);
					if (simpleDestMatch) {
						lastFilename = simpleDestMatch[1].trim();
					}

					// Check for "has already been downloaded"
					const alreadyMatch = line.match(
						/\[download\] (.+) has already been downloaded/
					);
					if (alreadyMatch) {
						lastFilename = alreadyMatch[1].trim();
					}

					const progress = parseProgress(line);
					if (progress) {
						progress.filename = lastFilename;
						if (currentPlaylistIndex !== undefined && totalPlaylistCount !== undefined) {
							progress.playlistIndex = currentPlaylistIndex;
							progress.playlistCount = totalPlaylistCount;
						}
						this.emit("progress", progress);
					}
				}
			});

			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on("close", (code: number) => {
				this._isDownloading = false;
				this.currentProcess = null;

				if (code === 0) {
					const result: DownloadProgress = {
						percent: 100,
						totalSize: "—",
						speed: "—",
						eta: "0:00",
						status: "finished",
						filename: lastFilename,
					};
					this.emit("progress", result);
					this.emit("complete", lastFilename);
					resolve(lastFilename);
				} else {
					const errorMsg = `yt-dlp завершился с кодом ${code}: ${stderr.trim()}`;
					const errorProgress: DownloadProgress = {
						percent: 0,
						totalSize: "—",
						speed: "—",
						eta: "—",
						status: "error",
					};
					this.emit("progress", errorProgress);
					this.emit("error", errorMsg);
					reject(new Error(errorMsg));
				}
			});

			proc.on("error", (err: Error) => {
				this._isDownloading = false;
				this.currentProcess = null;
				this.emit("error", err.message);
				reject(err);
			});
		});
	}

	/**
	 * Cancel the current download
	 */
	cancelDownload(): void {
		if (this.currentProcess) {
			this.currentProcess.kill("SIGTERM");
			this._isDownloading = false;
			this.currentProcess = null;
			this.emit("cancelled");
		}
	}
}

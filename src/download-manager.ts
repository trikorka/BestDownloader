import { EventEmitter } from "events";
import {
	VideoInfo,
	DownloadOptions,
	DownloadProgress,
} from "./types";
import { parseProgress, sanitizeFilename } from "./utils";
import * as path from "path";
import * as fs from "fs";
import { spawn, exec } from "child_process";

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
	private activeProcesses: Set<ReturnType<typeof spawn>> = new Set();
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
	async getVideoInfo(url: string | string[]): Promise<VideoInfo> {
		if (Array.isArray(url) && url.length > 5) {
			const chunkSize = 5;
			const chunks: string[][] = [];
			for (let i = 0; i < url.length; i += chunkSize) {
				chunks.push(url.slice(i, i + chunkSize));
			}

			const results = await Promise.all(
				chunks.map(chunk => this._fetchVideoInfo(chunk))
			);

			const combinedEntries: any[] = [];
			for (const res of results) {
				if ((res.isPlaylist || res.isVirtualPlaylist) && res.entries) {
					combinedEntries.push(...res.entries);
				} else {
					combinedEntries.push({
						id: res.id,
						url: res.webpage_url,
						title: res.title,
						thumbnail: res.thumbnail,
						duration: res.duration,
						channel: res.channel
					});
				}
			}

			const videoInfo: VideoInfo = {
				id: "virtual-playlist",
				title: "Пользовательский список",
				description: "Список добавленных ссылок",
				thumbnail: combinedEntries.length > 0 ? combinedEntries[0].thumbnail : "",
				duration: 0,
				channel: "Смешанные",
				upload_date: "",
				view_count: 0,
				like_count: 0,
				formats: [],
				webpage_url: url[0],
				isPlaylist: true,
				isVirtualPlaylist: true,
				playlistCount: combinedEntries.length,
				entries: combinedEntries
			};
			this.lastVideoInfo = videoInfo;
			return videoInfo;
		}

		return this._fetchVideoInfo(url);
	}

	private async _fetchVideoInfo(url: string | string[]): Promise<VideoInfo> {
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
				"--ignore-errors",
			];

			if (settings.impersonateBrowser) {
				args.push("--impersonate", "chrome");
			}

			if (Array.isArray(url)) {
				args.push(...url);
			} else {
				args.push(url);
			}

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
				const lines = stdout.trim().split("\n").filter(l => l.trim() !== "");

				if (lines.length === 0) {
					if (code !== 0) {
						reject(
							new Error(
								`yt-dlp exited with code ${code}: ${stderr.trim()}`
							)
						);
					} else {
						reject(new Error("No metadata returned"));
					}
					return;
				}

				try {
					if (lines.length > 1 || Array.isArray(url)) {
						// Virtual playlist (multiple independent URLs)
						const entries: any[] = [];
						for (const line of lines) {
							try {
								const p = JSON.parse(line.trim()) as YtDlpRawInfo;
								const isP = p._type === "playlist" || Array.isArray(p.entries);
								if (isP && p.entries) {
									p.entries.forEach((e: any) => {
										entries.push({
											id: e.id || "",
											url: e.url || e.webpage_url || p.webpage_url || p.original_url || "",
											title: e.title || "Unknown",
											thumbnail: e.thumbnail || (e.thumbnails && e.thumbnails.length > 0 ? e.thumbnails[e.thumbnails.length - 1].url : ""),
											duration: e.duration || 0,
											channel: e.uploader || e.channel || p.uploader || p.channel || "Unknown"
										});
									});
								} else {
									entries.push({
										id: p.id || "",
										url: p.webpage_url || p.original_url || "",
										title: p.title || "Unknown",
										thumbnail: p.thumbnail || (p.thumbnails && p.thumbnails.length > 0 ? p.thumbnails[p.thumbnails.length - 1].url : ""),
										duration: p.duration || 0,
										channel: p.uploader || p.channel || "Unknown"
									});
								}
							} catch (parseErr) {
								console.warn("Failed to parse a line of yt-dlp output:", parseErr);
							}
						}

						const videoInfo: VideoInfo = {
							id: "virtual-playlist",
							title: "Пользовательский список",
							description: "Список добавленных ссылок",
							thumbnail: entries.length > 0 ? entries[0].thumbnail : "",
							duration: 0,
							channel: "Смешанные",
							upload_date: "",
							view_count: 0,
							like_count: 0,
							formats: [],
							webpage_url: Array.isArray(url) ? url[0] : url,
							isPlaylist: true,
							isVirtualPlaylist: true,
							playlistCount: entries.length,
							entries: entries
						};
						this.lastVideoInfo = videoInfo;
						resolve(videoInfo);
					} else {
						// Single URL parsing
						const info = JSON.parse(lines[0]) as YtDlpRawInfo;
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
							webpage_url: info.webpage_url || (Array.isArray(url) ? url[0] : url),
							filesize_approx: info.filesize_approx || undefined,
							isPlaylist: isPlaylist,
							playlistCount: isPlaylist && info.entries ? info.entries.length : undefined,
							entries: isPlaylist && info.entries ? info.entries.map((e: YtDlpRawEntry) => ({
								id: e.id || "",
								url: e.url || e.webpage_url || info.webpage_url || info.original_url || "",
								title: e.title || "Unknown",
								thumbnail: e.thumbnail || (e.thumbnails && e.thumbnails.length > 0 ? e.thumbnails[e.thumbnails.length - 1].url : ""),
								duration: e.duration || 0,
								channel: e.uploader || e.channel || info.uploader || info.channel || "Unknown"
							})) : undefined,
						};
						this.lastVideoInfo = videoInfo;
						resolve(videoInfo);
					}
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
		this._isDownloading = true;

		// Concurrent playlist
		if (
			(options.isPlaylist && options.playlistItems && options.playlistItems.length > 0 && this.settingsGetter().concurrentPlaylist) ||
			(options.virtualPlaylistUrls && options.virtualPlaylistUrls.length > 0 && this.settingsGetter().concurrentPlaylist)
		) {
			return this.downloadPlaylistPipeline(options);
		}

		this.emit("start", options);

		if (options.isPlaylist && options.playlistItems && options.playlistItems.length > 1) {
			return this.downloadPlaylistPipeline(options);
		}

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
				ffmpegPath,
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

			let filename = options.filename
				? sanitizeFilename(options.filename)
				: "%(title)s.%(ext)s";
			
			if (options.isPlaylist) {
				filename = "%(playlist_index)s - " + filename;
			}
				
			const outputTemplate = path.join(options.outputPath, filename);
			args.push("-o", outputTemplate);

			const thumbnailEnabled = this.settingsGetter().downloadThumbnail;
			if (thumbnailEnabled && options.thumbnailPath) {
				if (!fs.existsSync(options.thumbnailPath)) {
					fs.mkdirSync(options.thumbnailPath, { recursive: true });
				}
				args.push("--write-thumbnail");
				
				const format = this.settingsGetter().thumbnailFormat;
				if (format === "png") {
					args.push("--convert-thumbnails", "png");
				} else if (format === "jpg") {
					args.push("--convert-thumbnails", "jpg");
				}
				
				const thumbTemplate = path.join(options.thumbnailPath, filename);
				args.push("-o", `thumbnail:${thumbTemplate}`);
			}

			args.push("--postprocessor-args", "ffmpeg:-threads 0");

			if (options.type === "audio") {
				let preferExt = "";
				if (options.audioFormat === "m4a") preferExt = "[ext=m4a]";
				else if (options.audioFormat === "opus") preferExt = "[ext=webm]";

				args.push("-f", `bestaudio${preferExt}/bestaudio/best`);
				args.push("-x");
				
				args.push("--audio-format", options.audioFormat);
				args.push("--audio-quality", "0");
			} else {
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
			this.activeProcesses.add(proc);

			let lastFilename = "";
			let stderr = "";
			let currentPlaylistIndex: number | undefined;
			let totalPlaylistCount: number | undefined;

			proc.stdout.on("data", (data: Buffer) => {
				const lines = data.toString().split("\n");
				for (const line of lines) {
					if (!line.trim()) continue;

					const playlistMatch = line.match(/\[download\] Downloading video (\d+) of (\d+)/);
					if (playlistMatch) {
						currentPlaylistIndex = parseInt(playlistMatch[1], 10);
						totalPlaylistCount = parseInt(playlistMatch[2], 10);
					}

					const destMatch = line.match(
						/\[(?:download|Merger|ExtractAudio)\].*?(?:Destination|Merging formats into|Converting).*?"?([^"\n]+)"?/
					);
					if (destMatch) {
						lastFilename = destMatch[1].trim().replace(/^"|"$/g, "");
					}

					const simpleDestMatch = line.match(
						/\[download\] Destination: (.+)/
					);
					if (simpleDestMatch) {
						lastFilename = simpleDestMatch[1].trim();
					}

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
				this.activeProcesses.delete(proc);
				if (this.activeProcesses.size === 0) {
					this._isDownloading = false;
				}

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
				this.activeProcesses.delete(proc);
				if (this.activeProcesses.size === 0) {
					this._isDownloading = false;
				}
				this.emit("error", err.message);
				reject(err);
			});
		});
	}

	/**
	 * Cancel the current download
	 */
	cancelDownload(): void {
		for (const proc of this.activeProcesses) {
			const pid = proc.pid;
			if (pid) {
				exec(`taskkill /pid ${pid} /T /F`, (err) => {
					if (err) {
						console.error("Не удалось завершить дерево процессов:", err);
					}
				});
			} else {
				proc.kill("SIGKILL");
			}
		}
		this.activeProcesses.clear();
		this._isDownloading = false;
		this.emit("cancelled");
	}

	private async downloadPlaylistPipeline(options: DownloadOptions): Promise<string> {
		const settings = this.settingsGetter();
		
		const isVirtual = options.virtualPlaylistUrls && options.virtualPlaylistUrls.length > 0;
		const itemsCount = isVirtual ? options.virtualPlaylistUrls!.length : (options.playlistItems?.length || 0);
		if (itemsCount === 0) return Promise.resolve("");

		let lastFilename = "";
		let hasError = false;
		let playlistProgressState: number[] = Array.from({ length: itemsCount }, () => 0);

		return new Promise((resolve, reject) => {
			const runItem = async (itemIndex: number, currentItemNumber: number) => {
				return new Promise<void>((itemResolve, itemReject) => {
					const isWin = process.platform === "win32";
					const ytDlpPath = path.join(this.pluginDir, "bin", isWin ? "yt-dlp.exe" : "yt-dlp");
					const ffmpegPath = path.join(this.pluginDir, "bin", isWin ? "ffmpeg.exe" : "ffmpeg");

					const args: string[] = [
						"--newline",
						"--no-warnings",
						"--ffmpeg-location",
						ffmpegPath
					];

					if (isVirtual) {
						args.push("--no-playlist");
					} else {
						args.push(
							"--yes-playlist",
							"--playlist-items",
							String(currentItemNumber)
						);
					}

					if (settings.impersonateBrowser) {
						args.push("--impersonate", "chrome");
					}

					let filename = options.filename ? sanitizeFilename(options.filename) : "%(title)s.%(ext)s";
					filename = "%(playlist_index)s - " + filename;
						
					const outputTemplate = path.join(options.outputPath, filename);
					args.push("-o", outputTemplate);

					if (settings.downloadThumbnail && options.thumbnailPath) {
						if (!fs.existsSync(options.thumbnailPath)) {
							fs.mkdirSync(options.thumbnailPath, { recursive: true });
						}
						args.push("--write-thumbnail");
						
						const format = settings.thumbnailFormat;
						if (format === "png") args.push("--convert-thumbnails", "png");
						else if (format === "jpg") args.push("--convert-thumbnails", "jpg");
						
						const thumbTemplate = path.join(options.thumbnailPath, filename);
						args.push("-o", `thumbnail:${thumbTemplate}`);
					}

					args.push("--postprocessor-args", "ffmpeg:-threads 0");

					if (options.type === "audio") {
						let preferExt = "";
						if (options.audioFormat === "m4a") preferExt = "[ext=m4a]";
						else if (options.audioFormat === "opus") preferExt = "[ext=webm]";

						args.push("-f", `bestaudio${preferExt}/bestaudio/best`);
						args.push("-x", "--audio-format", options.audioFormat, "--audio-quality", "0");
					} else {
						const quality = options.videoQuality === "best" ? "" : `[height<=${options.videoQuality}]`;
						switch (options.videoFormat) {
							case "mp4":
								args.push("-f", `bestvideo${quality}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${quality}+bestaudio/best${quality}[ext=mp4]/best${quality}`);
								args.push("--merge-output-format", "mp4");
								break;
							case "webm":
								args.push("-f", `bestvideo${quality}[ext=webm]+bestaudio[ext=webm]/bestvideo${quality}+bestaudio/best${quality}`);
								args.push("--merge-output-format", "webm");
								break;
							case "mkv":
								args.push("-f", `bestvideo${quality}+bestaudio/best${quality}`);
								args.push("--merge-output-format", "mkv");
								break;
						}
					}

					if (isVirtual) {
						args.push(options.virtualPlaylistUrls![itemIndex]);
					} else {
						args.push(options.url);
					}

					// Emit starting progress so UI knows we are fetching metadata
					const overallPercent = playlistProgressState.reduce((a, b) => a + b, 0) / itemsCount;
					const startingProgress: DownloadProgress = {
						percent: overallPercent,
						itemPercent: 0,
						totalSize: "—",
						speed: "—",
						eta: "—",
						status: "starting",
						playlistIndex: itemIndex + 1,
						playlistCount: itemsCount
					};
					this.emit("progress", startingProgress);
					
					const proc = spawn(ytDlpPath, args);
					this.activeProcesses.add(proc);

					let chunkStderr = "";
					let networkFinished = false;
					let seenDestinations = new Set<string>();
					let currentStage = 0; // 0=video, 1=audio, 2=merge

					proc.stdout.on("data", (data: Buffer) => {
						const lines = data.toString().split("\n");
						for (const line of lines) {
							if (!line.trim()) continue;

							const destMatch = line.match(/\[(?:download|Merger|ExtractAudio)\].*?(?:Destination|Merging formats into|Converting).*?"?([^"\n]+)"?/);
							let localLastFilename = "";
							if (destMatch) localLastFilename = destMatch[1].trim().replace(/^"|"$/g, "");

							const simpleDestMatch = line.match(/\[download\] Destination: (.+)/);
							if (simpleDestMatch) localLastFilename = simpleDestMatch[1].trim();

							const alreadyMatch = line.match(/\[download\] (.+) has already been downloaded/);
							if (alreadyMatch) localLastFilename = alreadyMatch[1].trim();

							if (localLastFilename) {
								lastFilename = localLastFilename;
								if (!seenDestinations.has(localLastFilename)) {
									seenDestinations.add(localLastFilename);
									if (seenDestinations.size === 1) currentStage = 0;
									else if (seenDestinations.size >= 2) currentStage = 1;
								}
							}

							const progress = parseProgress(line);
							if (progress) {
								progress.filename = localLastFilename || lastFilename;
								
								if (progress.status === "merging" || progress.status === "converting") {
									currentStage = 2;
								}
								
								let cumulativeItemPercent = 0;
								if (currentStage === 0) cumulativeItemPercent = progress.percent * 0.7;
								else if (currentStage === 1) cumulativeItemPercent = 70 + (progress.percent * 0.2);
								else if (currentStage === 2) cumulativeItemPercent = 90;
								
								playlistProgressState[itemIndex] = cumulativeItemPercent;
								const overallPercent = playlistProgressState.reduce((a, b) => a + b, 0) / itemsCount;
								
								const aggregatedProgress: DownloadProgress = {
									...progress,
									percent: overallPercent,
									itemPercent: cumulativeItemPercent,
									playlistIndex: itemIndex + 1,
									playlistCount: itemsCount
								};
								
								this.emit("progress", aggregatedProgress);

								if (!networkFinished && currentStage === 2) {
									if (settings.concurrentPlaylist) {
										networkFinished = true;
										itemResolve();
									}
								}
							}
						}
					});

					proc.stderr.on("data", (data: Buffer) => {
						chunkStderr += data.toString();
					});

					proc.on("close", (code: number) => {
						this.activeProcesses.delete(proc);
						
						if (code === 0) {
							playlistProgressState[itemIndex] = 100;
							const overallPercent = playlistProgressState.reduce((a, b) => a + b, 0) / itemsCount;
							// Process finished completely! Let's notify the UI so it can update the card.
							const itemFinishedProgress: DownloadProgress = {
								percent: overallPercent,
								totalSize: "—",
								speed: "—",
								eta: "—",
								status: "item_finished",
								playlistIndex: itemIndex + 1,
								playlistCount: itemsCount
							};
							this.emit("progress", itemFinishedProgress);
						} else {
							// Failed item (hidden/private/deleted video) — skip it, don't halt the pipeline
							console.warn(`yt-dlp failed for playlist item ${currentItemNumber} (code ${code}): ${chunkStderr.trim()}`);
							playlistProgressState[itemIndex] = 100; // Mark as "done" so progress moves forward
							const overallPercent = playlistProgressState.reduce((a, b) => a + b, 0) / itemsCount;
							const itemErrorProgress: DownloadProgress = {
								percent: overallPercent,
								totalSize: "—",
								speed: "—",
								eta: "—",
								status: "item_finished",
								playlistIndex: itemIndex + 1,
								playlistCount: itemsCount,
								itemError: true
							};
							this.emit("progress", itemErrorProgress);
						}

						if (!networkFinished) {
							networkFinished = true;
							// Always resolve — even on error — so the pipeline continues to the next item
							itemResolve();
						}
					});

					proc.on("error", (err: Error) => {
						this.activeProcesses.delete(proc);
						if (!networkFinished) {
							networkFinished = true;
							console.warn(`yt-dlp process error for playlist item ${currentItemNumber}:`, err.message);
							playlistProgressState[itemIndex] = 100;
							this.emit("progress", {
								percent: playlistProgressState.reduce((a, b) => a + b, 0) / itemsCount,
								itemPercent: 100,
								totalSize: "—",
								speed: "—",
								eta: "—",
								status: "item_finished",
								filename: lastFilename,
								playlistIndex: itemIndex + 1,
								playlistCount: itemsCount,
								itemError: false
							});
							itemResolve(); // Don't reject — continue pipeline
						}
					});
				});
			};

			const runPipeline = async () => {
				try {
					for (let i = 0; i < itemsCount; i++) {
						if (!this._isDownloading) break;
						await runItem(i, isVirtual ? 0 : options.playlistItems![i]);
					}
					
					const waitForProcesses = () => {
						if (this.activeProcesses.size === 0) {
							this._isDownloading = false;
							if (!hasError) {
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
							}
						} else {
							window.setTimeout(waitForProcesses, 500);
						}
					};
					waitForProcesses();
				} catch (err) {
					this._isDownloading = false;
					this.emit("error", err instanceof Error ? err.message : String(err));
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			};

			void runPipeline();
		});
	}
}

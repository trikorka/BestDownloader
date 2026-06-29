import { Plugin, Notice } from "obsidian";
import { PluginSettings, DEFAULT_SETTINGS } from "./types";
import { DownloadManager } from "./download-manager";
import { DownloadView, VIEW_TYPE_DOWNLOADER } from "./download-view";
import { BestDownloaderSettingTab } from "./settings";
import { applyNoteTemplate, getCurrentDate, formatDuration, sanitizeFilename } from "./utils";
import * as path from "path";
import * as fs from "fs";

export default class BestDownloaderPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	downloadManager!: DownloadManager;
	lastProcessedUrl: string = "";

	async onload() {
		await this.loadSettings();

		const adapter = this.app.vault.adapter as any;
		const basePath = adapter.getBasePath ? adapter.getBasePath() : (adapter.basePath || ".");
		const pluginDir = path.join(basePath, ".obsidian", "plugins", this.manifest.id);

		this.downloadManager = new DownloadManager(pluginDir, () => this.settings);

		// Listen for completed downloads to create notes
		this.downloadManager.on("complete", (filename: string) => {
			if (this.settings.createNote && filename) {
				this.createVideoNote(filename);
			}
		});

		// Add ribbon icon
		this.addRibbonIcon("download", "Best Downloader", () => {
			this.activateView();
		});

		// Add command
		this.addCommand({
			id: "download-youtube",
			name: "Открыть панель скачивания",
			callback: () => {
				this.activateView();
			},
		});

		// Register view
		this.registerView(
			VIEW_TYPE_DOWNLOADER,
			(leaf) => new DownloadView(
				leaf,
				this.downloadManager,
				this,
				(this.app.vault.adapter as any).getBasePath
					? (this.app.vault.adapter as any).getBasePath()
					: (this.app.vault.adapter as any).basePath || "."
			)
		);

		// Add settings tab
		this.addSettingTab(new BestDownloaderSettingTab(this.app, this));
	}

	onunload() {
		if (this.downloadManager) {
			this.downloadManager.cancelDownload();
			this.downloadManager.removeAllListeners();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Open the download view in the sidebar
	 */
	private async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DOWNLOADER)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: VIEW_TYPE_DOWNLOADER,
					active: true,
				});
				leaf = rightLeaf;
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Creates a new markdown note for the downloaded video
	 */
	private async createVideoNote(filename: string) {
		try {
			if (!this.downloadManager.lastVideoInfo) return;

			const info = this.downloadManager.lastVideoInfo;
			
			const title = info.title;
			const safeTitle = sanitizeFilename(title);
			
			// Resolve download path
			let dlPath = this.settings.downloadPath.trim();
			if (!dlPath) dlPath = "downloads";
			dlPath = dlPath.replace(/\\/g, '/');
			
			// Note filename
			let noteFilename = `${dlPath}/${safeTitle}.md`;
			let count = 1;
			
			// Check if exists
			while (this.app.vault.getAbstractFileByPath(noteFilename)) {
				noteFilename = `${dlPath}/${safeTitle} (${count}).md`;
				count++;
			}
			
			const templateData = {
				title: title,
				channel: info.channel || "Unknown",
				duration: info.duration ? formatDuration(info.duration) : "Unknown",
				url: info.originalUrl,
				date: getCurrentDate()
			};
			
			const content = applyNoteTemplate(this.settings.noteTemplate, templateData);
			
			// Check if directory exists
			const parts = dlPath.split('/');
			let currentPath = '';
			
			for (const part of parts) {
				if (!part) continue;
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				const folder = this.app.vault.getAbstractFileByPath(currentPath);
				if (!folder) {
					await this.app.vault.createFolder(currentPath);
				}
			}
			
			await this.app.vault.create(noteFilename, content);
			
			new Notice(`Создана заметка: ${noteFilename}`);
			
		} catch (e) {
			console.error("Ошибка при создании заметки:", e);
			new Notice(`Не удалось создать заметку: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}

import { Plugin, FileSystemAdapter } from "obsidian";
import { PluginSettings, DEFAULT_SETTINGS } from "./types";
import { DownloadManager } from "./download-manager";
import { DownloadView, VIEW_TYPE_DOWNLOADER } from "./download-view";
import { BestDownloaderSettingTab } from "./settings";
import { OnboardingModal } from "./onboarding-modal";

import * as path from "path";

export default class BestDownloaderPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	downloadManager!: DownloadManager;
	lastProcessedUrl: string = "";

	async onload() {
		await this.loadSettings();

		const basePath = this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : ".";
		const pluginDir = path.join(basePath, this.app.vault.configDir, "plugins", this.manifest.id);

		this.downloadManager = new DownloadManager(pluginDir, () => this.settings);


		// Add ribbon icon
		this.addRibbonIcon("download", "Best Downloader", () => {
			void this.activateView();
		});

		// Add command
		this.addCommand({
			id: "download-youtube",
			name: "Открыть панель скачивания",
			callback: () => {
				void this.activateView();
			},
		});

		// Register view
		this.registerView(
			VIEW_TYPE_DOWNLOADER,
			(leaf) => new DownloadView(
				leaf,
				this.downloadManager,
				this,
				this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : "."
			)
		);

		// Add settings tab
		this.addSettingTab(new BestDownloaderSettingTab(this.app, this));

		// Show onboarding modal on first launch
		this.app.workspace.onLayoutReady(() => {
			if (!this.settings.hasCompletedOnboarding) {
				new OnboardingModal(this.app, this).open();
			}
		});
	}

	onunload() {
		if (this.downloadManager) {
			this.downloadManager.cancelDownload();
			this.downloadManager.removeAllListeners();
		}
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<PluginSettings> | null;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			data ?? {}
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
			await workspace.revealLeaf(leaf);
		}
	}

}

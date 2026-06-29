import { ItemView, WorkspaceLeaf, Notice, App, setIcon } from "obsidian";
import type BestDownloaderPlugin from "./main";
import { DownloadManager } from "./download-manager";
import {
	PluginSettings,
	VideoInfo,
	DownloadOptions,
	DownloadProgress,
	DownloadType,
	VideoFormat,
	VideoQuality,
	AudioFormat,
} from "./types";
import {
	isValidYouTubeUrl,
	formatDuration,
	formatFileSize,
} from "./utils";
import * as path from "path";

export const VIEW_TYPE_DOWNLOADER = "best-downloader-view";

export class DownloadView extends ItemView {
	private downloadManager: DownloadManager;
	private plugin: BestDownloaderPlugin;
	private vaultPath: string;
	private videoInfo: VideoInfo | null = null;
	
	// UI Elements
	private urlInput!: HTMLInputElement;
	private errorMsg!: HTMLElement;
	private contentContainer!: HTMLElement;

	// State
	private downloadType: DownloadType = "video";
	private videoFormat: VideoFormat = "mp4";
	private videoQuality: VideoQuality = "1080";
	private audioFormat: AudioFormat = "mp3";
	private selectedPlaylistIndices: Set<number> = new Set();

	constructor(
		leaf: WorkspaceLeaf,
		downloadManager: DownloadManager,
		plugin: BestDownloaderPlugin,
		vaultPath: string
	) {
		super(leaf);
		this.downloadManager = downloadManager;
		this.plugin = plugin;
		this.vaultPath = vaultPath;

		// Apply defaults from settings
		this.videoFormat = plugin.settings.defaultVideoFormat;
		this.videoQuality = plugin.settings.defaultVideoQuality;
		this.audioFormat = plugin.settings.defaultAudioFormat;
	}

	getViewType(): string {
		return VIEW_TYPE_DOWNLOADER;
	}

	getDisplayText(): string {
		return "YouTube Downloader";
	}

	getIcon(): string {
		return "download";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement; // Content element for views
		container.empty();
		container.addClass("bd-download-view");
		this.renderMainView(container);
	}

	async onClose() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		this.downloadManager.removeAllListeners("progress");
		if (this.downloadManager.isDownloading) {
			this.downloadManager.cancelDownload();
		}
	}

	/**
	 * Main View: Header and URL Input always visible
	 */
	private renderMainView(container: HTMLElement) {
		container.empty();

		const header = container.createDiv({ cls: "bd-view-header" });
		header.createEl("h2", { text: "Скачать видео" });
		
		const settingsBtn = header.createEl("button", {
			cls: "clickable-icon",
			title: "Настройки плагина",
		});
		setIcon(settingsBtn, "settings");
		settingsBtn.addEventListener("click", () => {
			// @ts-ignore
			this.app.setting.open();
			// @ts-ignore
			this.app.setting.openTabById(this.plugin.manifest.id);
		});

		const inputGroup = container.createDiv({ cls: "bd-input-group" });
		this.urlInput = inputGroup.createEl("input", {
			type: "text",
			placeholder: "Ссылка на YouTube...",
			cls: "bd-url-input",
		});

		this.errorMsg = container.createDiv({ cls: "bd-error-msg" });
		this.errorMsg.style.display = "none";

		this.contentContainer = container.createDiv({ cls: "bd-content-container flex-col" });

		const triggerFetch = async () => {
			const url = this.urlInput.value.trim();

			if (!url) {
				this.errorMsg.style.display = "block";
				this.errorMsg.setText("Введите ссылку");
				return;
			}

			if (!isValidYouTubeUrl(url)) {
				this.errorMsg.style.display = "block";
				this.errorMsg.setText("Некорректная ссылка");
				return;
			}

			this.errorMsg.style.display = "none";
			this.urlInput.disabled = true;
			this.urlInput.placeholder = "Получение информации...";
			this.plugin.lastProcessedUrl = url;
			
			// Show spinner in errorMsg container temporarily as a loading state
			this.errorMsg.empty();
			this.errorMsg.style.display = "flex";
			this.errorMsg.style.alignItems = "center";
			this.errorMsg.style.gap = "8px";
			this.errorMsg.style.color = "var(--text-muted)";
			this.errorMsg.style.background = "transparent";
			const loaderIcon = this.errorMsg.createSpan();
			setIcon(loaderIcon, "loader");
			(loaderIcon.firstChild as HTMLElement).style.animation = "bd-spin 2s linear infinite";
			this.errorMsg.createSpan({ text: "Загрузка информации о видео..." });

			try {
				this.videoInfo = await this.downloadManager.getVideoInfo(url);
				this.errorMsg.style.display = "none"; // Hide loading spinner
				this.urlInput.disabled = false;
				this.urlInput.placeholder = "Ссылка на YouTube...";
				this.renderVideoInfo();
			} catch (e) {
				this.errorMsg.style.display = "block";
				this.errorMsg.style.color = "";
				this.errorMsg.style.background = "";
				
				// Format error as Callout
				this.errorMsg.empty();
				const calloutTitle = this.errorMsg.createDiv({ cls: "callout-title" });
				const calloutIcon = calloutTitle.createDiv({ cls: "callout-icon" });
				setIcon(calloutIcon, "alert-triangle");
				calloutTitle.createDiv({ cls: "callout-title-inner", text: "Ошибка" });
				
				const calloutContent = this.errorMsg.createDiv({ cls: "callout-content" });
				calloutContent.setText(`${e instanceof Error ? e.message : String(e)}`);
				
				this.urlInput.disabled = false;
				this.urlInput.placeholder = "Ссылка на YouTube...";
				this.urlInput.focus();
			}
		};



		// Submit on Enter
		this.urlInput.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !this.urlInput.disabled) {
				const url = this.urlInput.value.trim();
				if (isValidYouTubeUrl(url)) {
					this.selectedPlaylistIndices.clear();
					triggerFetch();
				}
			}
		});

		this.urlInput.addEventListener("input", () => {
			const url = this.urlInput.value.trim();
			if (isValidYouTubeUrl(url) && !this.urlInput.disabled) {
				this.selectedPlaylistIndices.clear();
				triggerFetch();
			}
		});
	}

	/**
	 * Step 2: Video info + download options
	 */
	private renderVideoInfo() {
		this.contentContainer.empty();

		if (!this.videoInfo) return;

		const info = this.videoInfo;

		if (info.isPlaylist && info.entries && info.entries.length > 0) {
			// Init selections (1-based index)
			info.entries.forEach((_, i) => this.selectedPlaylistIndices.add(i + 1));
			
			const entriesList = this.contentContainer.createDiv({ cls: "bd-playlist-entries" });
			
			// Playlist Header Row
			const headerRow = entriesList.createDiv({ cls: "bd-playlist-header-row" });
			headerRow.createEl("h3", { text: info.title, cls: "bd-playlist-main-title" });
			
			const toggleAllBtn = headerRow.createSpan({ cls: "bd-toggle-all-btn clickable-icon" });
			
			const updateToggleIcon = () => {
				toggleAllBtn.empty();
				if (this.selectedPlaylistIndices.size === info.entries.length && info.entries.length > 0) {
					setIcon(toggleAllBtn, "check-square");
				} else {
					setIcon(toggleAllBtn, "square");
				}
			};
			
			updateToggleIcon();
			
			const checkboxes: HTMLInputElement[] = [];
			
			info.entries.forEach((entry, idx) => {
				const itemIndex = idx + 1;
				const item = entriesList.createDiv({ cls: "bd-playlist-item" });
				
				// Checkbox
				const checkboxContainer = item.createDiv({ cls: "bd-checkbox-container" });
				const checkbox = checkboxContainer.createEl("input", { type: "checkbox" });
				checkbox.checked = this.selectedPlaylistIndices.has(itemIndex);
				checkboxes.push(checkbox);
				
				checkbox.addEventListener("change", () => {
					if (checkbox.checked) {
						this.selectedPlaylistIndices.add(itemIndex);
					} else {
						this.selectedPlaylistIndices.delete(itemIndex);
					}
					document.dispatchEvent(new CustomEvent("bd-playlist-selection-changed"));
					updateToggleIcon();
				});
				
				// Click item to toggle checkbox (except on checkbox itself)
				item.addEventListener("click", (e) => {
					if (e.target !== checkbox) {
						checkbox.checked = !checkbox.checked;
						checkbox.dispatchEvent(new Event("change"));
					}
				});
				
				const itemThumbContainer = item.createDiv({ cls: "bd-playlist-item-thumb-container" });
				if (entry.thumbnail) {
					const itemThumb = itemThumbContainer.createEl("img", { cls: "bd-playlist-item-thumb" });
					itemThumb.src = entry.thumbnail;
				}
				if (entry.duration) {
					itemThumbContainer.createDiv({
						cls: "bd-duration-badge bd-duration-small",
						text: formatDuration(entry.duration),
					});
				}
				
				const itemMeta = item.createDiv({ cls: "bd-playlist-item-meta" });
				itemMeta.createEl("h4", { text: entry.title, cls: "bd-playlist-item-title" });
				itemMeta.createEl("span", { text: entry.channel, cls: "bd-playlist-item-channel" });
			});
			
			toggleAllBtn.addEventListener("click", () => {
				const isAllSelected = this.selectedPlaylistIndices.size === info.entries.length;
				
				checkboxes.forEach((cb, idx) => {
					cb.checked = !isAllSelected;
					if (!isAllSelected) {
						this.selectedPlaylistIndices.add(idx + 1);
					} else {
						this.selectedPlaylistIndices.delete(idx + 1);
					}
				});
				updateToggleIcon();
				document.dispatchEvent(new CustomEvent("bd-playlist-selection-changed"));
			});
		} else {
			// Regular Video card
			const card = this.contentContainer.createDiv({ cls: "bd-video-card" });

			if (info.thumbnail) {
				const thumbContainer = card.createDiv({ cls: "bd-thumb-container" });
				const thumb = thumbContainer.createEl("img", {
					cls: "bd-thumbnail",
				});
				thumb.src = info.thumbnail;
				thumb.alt = info.title;

				if (info.duration) {
					thumbContainer.createDiv({
						cls: "bd-duration-badge",
						text: formatDuration(info.duration),
					});
				}
			}

			const meta = card.createDiv({ cls: "bd-video-meta" });
			meta.createEl("h3", { text: info.title, cls: "bd-video-title" });

			const details = meta.createDiv({ cls: "bd-video-details" });
			details.createEl("span", {
				text: info.channel,
				cls: "bd-detail bd-channel-detail",
			});
		}

		// Options section
		const optionsSection = this.contentContainer.createDiv({ cls: "bd-section bd-options-section" });

		const renderOptions = () => {
			optionsSection.empty();
			const selectorsRow = optionsSection.createDiv({ cls: "bd-selectors-row" });
			
			// Type
			const typeCol = selectorsRow.createDiv({ cls: "bd-selector-col" });
			typeCol.createEl("label", { text: "ТИП", cls: "bd-section-label" });
			const typeSelect = typeCol.createEl("select", { cls: "dropdown bd-dropdown" });
			
			const typeOptions = [
				{ value: "video", label: "Видео" },
				{ value: "audio", label: "Аудио" }
			];
			for (const t of typeOptions) {
				const opt = typeSelect.createEl("option", { value: t.value, text: t.label });
				opt.selected = this.downloadType === t.value;
			}
			typeSelect.addEventListener("change", () => {
				this.downloadType = typeSelect.value as DownloadType;
				renderOptions();
			});

			if (this.downloadType === "video") {
				// Video format
				const formatCol = selectorsRow.createDiv({ cls: "bd-selector-col" });
				formatCol.createEl("label", { text: "ФОРМАТ", cls: "bd-section-label" });
				const formatSelect = formatCol.createEl("select", { cls: "dropdown bd-dropdown" });
				const formats: VideoFormat[] = ["mp4", "webm", "mkv"];
				for (const fmt of formats) {
					const opt = formatSelect.createEl("option", { value: fmt, text: fmt.toUpperCase() });
					opt.selected = this.videoFormat === fmt;
				}
				formatSelect.addEventListener("change", () => {
					this.videoFormat = formatSelect.value as VideoFormat;
				});

				// Quality
				const qualityCol = selectorsRow.createDiv({ cls: "bd-selector-col" });
				qualityCol.createEl("label", { text: "КАЧЕСТВО", cls: "bd-section-label" });
				const qualitySelect = qualityCol.createEl("select", { cls: "dropdown bd-dropdown" });
				const qualities: { value: VideoQuality; label: string }[] = [
					{ value: "360", label: "360p" },
					{ value: "480", label: "480p" },
					{ value: "720", label: "720p" },
					{ value: "1080", label: "1080p" },
					{ value: "best", label: "Max (Best)" },
				];
				for (const q of qualities) {
					const opt = qualitySelect.createEl("option", { value: q.value, text: q.label });
					opt.selected = this.videoQuality === q.value;
				}
				qualitySelect.addEventListener("change", () => {
					this.videoQuality = qualitySelect.value as VideoQuality;
				});
			} else {
				// Audio format
				const formatCol = selectorsRow.createDiv({ cls: "bd-selector-col" });
				formatCol.createEl("label", { text: "ФОРМАТ", cls: "bd-section-label" });
				const formatSelect = formatCol.createEl("select", { cls: "dropdown bd-dropdown" });
				const formats: AudioFormat[] = ["mp3", "m4a", "ogg", "wav", "opus"];
				for (const fmt of formats) {
					const opt = formatSelect.createEl("option", { value: fmt, text: fmt.toUpperCase() });
					opt.selected = this.audioFormat === fmt;
				}
				formatSelect.addEventListener("change", () => {
					this.audioFormat = formatSelect.value as AudioFormat;
				});
			}
		};

		renderOptions();

		// Download button
		const btnRow = this.contentContainer.createDiv({ cls: "bd-btn-row" });
		const downloadBtn = btnRow.createEl("button", {
			cls: "bd-download-btn mod-cta",
		});
		downloadBtn.style.display = "flex";
		downloadBtn.style.alignItems = "center";
		downloadBtn.style.justifyContent = "center";
		downloadBtn.style.gap = "8px";
		const dlIcon = downloadBtn.createSpan();
		setIcon(dlIcon, "download");
		const dlText = downloadBtn.createSpan({ text: "Скачать" });
		
		// Full width in sidebar
		downloadBtn.style.width = "100%";

		const updateDownloadBtn = () => {
			if (info.isPlaylist && info.entries) {
				const selectedCount = this.selectedPlaylistIndices.size;
				if (selectedCount === 0) {
					dlText.setText("Ничего не выбрано");
					downloadBtn.disabled = true;
					downloadBtn.removeClass("mod-cta");
				} else if (selectedCount === info.entries.length) {
					dlText.setText(`Скачать весь плейлист (${selectedCount})`);
					downloadBtn.disabled = false;
					downloadBtn.addClass("mod-cta");
				} else {
					dlText.setText(`Скачать выбранные (${selectedCount})`);
					downloadBtn.disabled = false;
					downloadBtn.addClass("mod-cta");
				}
			}
		};

		updateDownloadBtn();

		const onSelectionChanged = () => updateDownloadBtn();
		document.addEventListener("bd-playlist-selection-changed", onSelectionChanged);

		downloadBtn.addEventListener("click", () => {
			document.removeEventListener("bd-playlist-selection-changed", onSelectionChanged);
			this.startDownload();
		});
	}

	/**
	 * Step 3: Download progress
	 */
	private async startDownload() {
		this.contentContainer.empty();

		if (!this.videoInfo) return;

		// Mini video card
		const miniCard = this.contentContainer.createDiv({ cls: "bd-mini-card" });
		miniCard.createEl("span", {
			text: this.videoInfo.title,
			cls: "bd-mini-title",
		});
		const formatLabel =
			this.downloadType === "video"
				? `${this.videoFormat.toUpperCase()}`
				: `${this.audioFormat.toUpperCase()}`;
		miniCard.createEl("span", {
			text: formatLabel,
			cls: "bd-mini-format",
		});

		// Progress section
		const progressSection = this.contentContainer.createDiv({ cls: "bd-progress-section" });

		const statusText = progressSection.createDiv({
			cls: "bd-progress-status",
		});
		
		const statusIcon = statusText.createSpan({ cls: "bd-status-icon" });
		const statusMsg = statusText.createSpan({ text: "Начало загрузки..." });

		const progressBar = progressSection.createEl("progress", {
			cls: "bd-progress-bar",
		});
		progressBar.setAttr("max", "100");
		progressBar.setAttr("value", "0");

		const progressDetails = progressSection.createDiv({
			cls: "bd-progress-details bd-progress-vertical",
		});
		const speedEl = progressDetails.createEl("span", {
			text: "Скорость: —",
			cls: "bd-progress-detail",
		});
		const etaEl = progressDetails.createEl("span", {
			text: "Осталось: —",
			cls: "bd-progress-detail",
		});
		const sizeEl = progressDetails.createEl("span", {
			text: "Размер: —",
			cls: "bd-progress-detail",
		});

		// Cancel button
		const btnRow = this.contentContainer.createDiv({ cls: "bd-btn-row" });
		const cancelBtn = btnRow.createEl("button", {
			text: "Отменить",
			cls: "bd-cancel-btn",
		});
		cancelBtn.style.width = "100%";

		// Listen for progress
		const onProgress = (progress: DownloadProgress) => {
			progressBar.setAttr("value", progress.percent.toString());

			switch (progress.status) {
				case "downloading": {
					statusIcon.empty();
					let msgPrefix = "";
					if (progress.playlistIndex && progress.playlistCount) {
						msgPrefix = `Видео ${progress.playlistIndex} из ${progress.playlistCount}: `;
					}
					statusMsg.setText(
						`${msgPrefix}Загрузка... ${progress.percent.toFixed(1)}%`
					);
					speedEl.setText(`Скорость: ${progress.speed}`);
					etaEl.setText(`Осталось: ${progress.eta}`);
					sizeEl.setText(`Размер: ${progress.totalSize}`);
					break;
				}
				case "merging":
					statusIcon.empty();
					setIcon(statusIcon, "loader");
					(statusIcon.firstChild as HTMLElement).style.animation = "bd-spin 2s linear infinite";
					statusMsg.setText("Объединение видео и аудио...");
					progressBar.removeAttribute("value"); // indeterminate state
					break;
				case "converting":
					statusIcon.empty();
					setIcon(statusIcon, "loader");
					(statusIcon.firstChild as HTMLElement).style.animation = "bd-spin 2s linear infinite";
					statusMsg.setText("Конвертация...");
					progressBar.removeAttribute("value"); // indeterminate state
					break;
				case "finished":
					statusIcon.empty();
					setIcon(statusIcon, "check-circle");
					(statusIcon.firstChild as HTMLElement).style.color = "var(--text-success)";
					statusMsg.setText("Успешно!");
					progressBar.setAttr("value", "100");
					cancelBtn.setText("Скачать другое");
					cancelBtn.addClass("mod-cta");
					break;
				case "error": {
					statusIcon.empty();
					setIcon(statusIcon, "alert-circle");
					(statusIcon.firstChild as HTMLElement).style.color = "var(--text-error)";
					statusMsg.setText("Ошибка");
					progressBar.addClass("bd-progress-error");
					cancelBtn.setText("Назад");
					break;
				}
			}
		};

		this.downloadManager.on("progress", onProgress);

		cancelBtn.addEventListener("click", () => {
			if (this.downloadManager.isDownloading) {
				this.downloadManager.cancelDownload();
				statusIcon.empty();
				statusMsg.setText("Отменено");
				progressBar.addClass("bd-progress-error");
				cancelBtn.setText("Скачать другое");
			} else {
				// Reset UI to start
				this.contentContainer.empty();
				this.urlInput.value = "";
				this.urlInput.disabled = false;
				this.urlInput.placeholder = "Ссылка на YouTube...";
				this.urlInput.focus();
			}
		});

		// Start download
		const outputPath = path.join(this.vaultPath, this.plugin.settings.downloadPath);

		const options: DownloadOptions = {
			url: this.videoInfo.webpage_url,
			type: this.downloadType,
			videoFormat: this.videoFormat,
			videoQuality: this.videoQuality,
			audioFormat: this.audioFormat,
			outputPath: outputPath,
			isPlaylist: this.videoInfo.isPlaylist,
			playlistItems: this.videoInfo.isPlaylist ? Array.from(this.selectedPlaylistIndices).sort((a,b) => a - b) : undefined,
		};

		try {
			const resultFile = await this.downloadManager.download(options);
			new Notice(`Загружено: ${path.basename(resultFile || this.videoInfo.title)}`);
		} catch (e) {
			if (
				e instanceof Error &&
				!e.message.includes("SIGTERM")
			) {
				new Notice(
					`Ошибка: ${e.message}`,
					10000
				);
			}
		} finally {
			this.downloadManager.removeListener("progress", onProgress);
		}
	}
}

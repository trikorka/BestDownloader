import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type BestDownloaderPlugin from "./main";
import { DownloadManager } from "./download-manager";
import {
	VideoInfo,
	DownloadOptions,
	DownloadProgress,
	DownloadType,
	VideoFormat,
	VideoQuality,
	AudioFormat,
} from "./types";
import {
	isValidUrl,
	formatDuration,
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
	private headerContainer!: HTMLElement;
	private inputGroupContainer!: HTMLElement;
	private emptyState!: HTMLElement;
	private selectionContainer!: HTMLElement;
	private downloadingContainer!: HTMLElement;

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
		return "Media Downloader";
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

	private renderDisclaimer(container: HTMLElement) {
		const disclaimerBlock = container.createDiv({ cls: "bd-disclaimer-block" });
		disclaimerBlock.createEl("h2", { text: "Отказ от ответственности" });
		disclaimerBlock.createEl("p", { text: "Плагин предназначен исключительно для добросовестного использования. Загрузка материалов, защищенных авторским правом, без разрешения правообладателя может нарушать закон." });
		disclaimerBlock.createEl("p", { text: "Пользователь несет полную ответственность за любые действия, совершаемые с помощью данного плагина, включая соблюдение условий использования сторонних сервисов." });
		disclaimerBlock.createEl("p", { text: "Автор плагина не несет ответственности за скачанный контент или блокировки со стороны сервисов." });
		
		const agreeBtn = disclaimerBlock.createEl("button", { text: "Я согласен", cls: "mod-warning bd-mt-15 bd-w-full" });
		agreeBtn.addEventListener("click", () => {
			void (async () => {
				this.plugin.settings.hasAcceptedDisclaimer = true;
				await this.plugin.saveSettings();
				this.renderMainView(container);
			})();
		});
	}

	/**
	 * Main View: Header and URL Input always visible
	 */
	private renderMainView(container: HTMLElement) {
		container.empty();

		if (!this.plugin.settings.hasAcceptedDisclaimer) {
			this.renderDisclaimer(container);
			return;
		}

		this.headerContainer = container.createDiv({ cls: "bd-view-header" });
		this.headerContainer.createEl("h2", { text: "Скачать видео" });
		
		const settingsBtn = this.headerContainer.createEl("button", {
			cls: "clickable-icon",
			title: "Настройки плагина",
		});
		setIcon(settingsBtn, "settings");
		settingsBtn.addEventListener("click", () => {
			interface AppWithSetting {
				setting: { open: () => void; openTabById: (id: string) => void };
			}
			const appWithSetting = this.app as unknown as AppWithSetting;
			appWithSetting.setting.open();
			appWithSetting.setting.openTabById(this.plugin.manifest.id);
		});

		this.inputGroupContainer = container.createDiv({ cls: "bd-input-group" });
		this.urlInput = this.inputGroupContainer.createEl("input", {
			type: "text",
			placeholder: "Ссылка на видео/аудио...",
			cls: "bd-url-input",
		});

		this.errorMsg = container.createDiv({ cls: "bd-error-msg" });
		this.errorMsg.hide();

		this.contentContainer = container.createDiv({ cls: "bd-content-container bd-flex-col bd-fade-in" });
		
		// Setup sub-containers
		this.emptyState = this.contentContainer.createDiv({ cls: "bd-empty-state" });
		const emptyIcon = this.emptyState.createDiv({ cls: "bd-empty-icon" });
		setIcon(emptyIcon, "download-cloud");
		this.emptyState.createDiv({ cls: "bd-empty-text", text: "Вставьте ссылку на видео или плейлист, чтобы начать загрузку" });

		this.selectionContainer = this.contentContainer.createDiv({ cls: "bd-selection-container" });
		this.selectionContainer.hide();

		this.downloadingContainer = this.contentContainer.createDiv({ cls: "bd-downloading-container" });
		this.downloadingContainer.hide();

		const triggerFetch = async () => {
			const url = this.urlInput.value.trim();

			if (!url) {
				this.errorMsg.show();
				this.errorMsg.setText("Введите ссылку");
				return;
			}

			if (!isValidUrl(url)) {
				this.errorMsg.show();
				this.errorMsg.setText("Некорректная ссылка");
				return;
			}

			this.errorMsg.hide();
			this.urlInput.disabled = true;
			this.urlInput.placeholder = "Получение информации...";
			this.plugin.lastProcessedUrl = url;
			
			// Show spinner in errorMsg container temporarily as a loading state
			this.errorMsg.empty();
			this.errorMsg.show();
			this.errorMsg.addClass("bd-error-loading");
			const loaderIcon = this.errorMsg.createSpan();
			setIcon(loaderIcon, "loader");
			(loaderIcon.firstChild as HTMLElement)?.addClass("bd-spin-anim");
			this.errorMsg.createSpan({ text: "Загрузка информации о видео..." });

			try {
				this.videoInfo = await this.downloadManager.getVideoInfo(url);
				this.errorMsg.hide(); // Hide loading spinner
				this.errorMsg.removeClass("bd-error-loading");
				this.urlInput.disabled = false;
				this.urlInput.placeholder = "Ссылка на видео/аудио...";
				this.emptyState.hide();
				this.selectionContainer.show();
				this.selectionContainer.addClass("bd-fade-in");
				this.downloadingContainer.hide();
				this.renderVideoInfo();
			} catch (e) {
				this.errorMsg.show();
				this.errorMsg.removeClass("bd-error-loading");
				
				// Format error as Callout
				this.errorMsg.empty();
				const calloutTitle = this.errorMsg.createDiv({ cls: "callout-title" });
				const calloutIcon = calloutTitle.createDiv({ cls: "callout-icon" });
				setIcon(calloutIcon, "alert-triangle");
				calloutTitle.createDiv({ cls: "callout-title-inner", text: "Ошибка" });
				
				const calloutContent = this.errorMsg.createDiv({ cls: "callout-content" });
				calloutContent.setText(`${e instanceof Error ? e.message : String(e)}`);
				
				this.urlInput.disabled = false;
				this.urlInput.placeholder = "Ссылка на видео/аудио...";
				this.urlInput.focus();
			}
		};



		// Submit on Enter
		this.urlInput.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !this.urlInput.disabled) {
				const url = this.urlInput.value.trim();
				if (isValidUrl(url)) {
					this.selectedPlaylistIndices.clear();
					void triggerFetch();
				}
			}
		});

		this.urlInput.addEventListener("input", () => {
			const url = this.urlInput.value.trim();
			if (isValidUrl(url) && !this.urlInput.disabled) {
				this.selectedPlaylistIndices.clear();
				void triggerFetch();
			}
		});
	}

	/**
	 * Step 2: Video info + download options
	 */
	private renderVideoInfo() {
		this.selectionContainer.empty();

		if (!this.videoInfo) return;

		const info = this.videoInfo;

		if (info.isPlaylist && info.entries && info.entries.length > 0) {
			// Init selections (1-based index)
			info.entries.forEach((_, i) => this.selectedPlaylistIndices.add(i + 1));
			
			const entriesList = this.selectionContainer.createDiv({ cls: "bd-playlist-entries" });
			
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
			const cardsContainer = entriesList.createDiv({ cls: "bd-playlist-cards-container" });
			
			info.entries.forEach((entry, idx) => {
				const itemIndex = idx + 1;
				const item = cardsContainer.createDiv({ cls: "bd-media-item bd-clickable-card" });
				
				// Checkbox
				const checkboxContainer = item.createDiv({ cls: "bd-media-action" });
				const checkbox = checkboxContainer.createEl("input", { type: "checkbox" });
				checkbox.checked = this.selectedPlaylistIndices.has(itemIndex);
				checkboxes.push(checkbox);
				
				checkbox.addEventListener("change", () => {
					if (checkbox.checked) {
						this.selectedPlaylistIndices.add(itemIndex);
					} else {
						this.selectedPlaylistIndices.delete(itemIndex);
					}
					activeDocument.dispatchEvent(new CustomEvent("bd-playlist-selection-changed"));
					updateToggleIcon();
				});
				
				// Click item to toggle checkbox (except on checkbox itself)
				item.addEventListener("click", (e) => {
					if (e.target !== checkbox) {
						checkbox.checked = !checkbox.checked;
						checkbox.dispatchEvent(new Event("change"));
					}
				});
				
				const itemThumbContainer = item.createDiv({ cls: "bd-media-thumb-container" });
				if (entry.thumbnail) {
					const itemThumb = itemThumbContainer.createEl("img", { cls: "bd-media-thumb" });
					itemThumb.src = entry.thumbnail;
				}
				if (entry.duration) {
					itemThumbContainer.createDiv({
						cls: "bd-duration-badge bd-duration-small",
						text: formatDuration(entry.duration),
					});
				}
				
				const itemMeta = item.createDiv({ cls: "bd-media-meta" });
				itemMeta.createEl("h4", { text: entry.title, cls: "bd-media-title" });
				itemMeta.createEl("span", { text: entry.channel, cls: "bd-media-channel" });
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
				activeDocument.dispatchEvent(new CustomEvent("bd-playlist-selection-changed"));
			});
		} else {
			// Single Video Card - Large card
			const card = this.selectionContainer.createDiv({ cls: "bd-video-card" });

			if (info.thumbnail) {
				const thumbContainer = card.createDiv({ cls: "bd-thumb-container" });
				const thumb = thumbContainer.createEl("img", {
					cls: "bd-thumbnail",
				});
				thumb.src = info.thumbnail;

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
				text: info.channel || "",
				cls: "bd-detail bd-channel-detail",
			});
		}

		// Options section
		const optionsSection = this.selectionContainer.createDiv({ cls: "bd-section bd-options-section" });

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
				const formats: AudioFormat[] = ["mp3", "m4a", "wav", "opus"];
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
		const btnRow = this.selectionContainer.createDiv({ cls: "bd-btn-row" });
		const downloadBtn = btnRow.createEl("button", {
			cls: "mod-cta bd-download-btn",
		});
		const dlIcon = downloadBtn.createSpan();
		setIcon(dlIcon, "download");
		const dlText = downloadBtn.createSpan({ text: "Скачать" });

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
		activeDocument.addEventListener("bd-playlist-selection-changed", onSelectionChanged);

		downloadBtn.addEventListener("click", () => {
			activeDocument.removeEventListener("bd-playlist-selection-changed", onSelectionChanged);
			void this.startDownload();
		});
	}

	/**
	 * Step 3: Download progress
	 */
	private async startDownload() {
		this.selectionContainer.hide();
		this.urlInput.disabled = true;
		
		this.downloadingContainer.empty();
		this.downloadingContainer.show();
		this.downloadingContainer.addClass("bd-fade-in");

		if (!this.videoInfo) return;

		let statusMsg: HTMLElement;
		let statusIcon: HTMLElement;
		let progressBar: HTMLProgressElement;
		let paramsEl: HTMLElement;
		let playlistCountEl: HTMLElement | undefined;

		// Playlist or Single Item Cards (vertical list)
		const playlistCards = new Map<number, {
			container: HTMLElement,
			statusText?: HTMLElement, // Will be undefined now
			progressBar: HTMLProgressElement,
			statusIcon: HTMLElement
		}>();

		if (this.videoInfo.isPlaylist && this.videoInfo.entries && this.selectedPlaylistIndices.size > 0) {
			const entriesList = this.downloadingContainer.createDiv({ cls: "bd-playlist-entries" });
			
			// Playlist Header Row
			const headerRow = entriesList.createDiv({ cls: "bd-playlist-header-row" });
			
			headerRow.createEl("h3", { text: this.videoInfo.title, cls: "bd-playlist-main-title" });
			
			const statusWrapper = headerRow.createDiv({ cls: "bd-playlist-status-wrapper" });
			statusIcon = statusWrapper.createSpan({ cls: "bd-status-icon bd-text-muted" });
			setIcon(statusIcon, "clock-3");
			statusMsg = statusWrapper.createSpan();

			paramsEl = headerRow.createEl("span", { text: "— | — | —", cls: "bd-progress-detail bd-playlist-params" });
			playlistCountEl = headerRow.createSpan({ cls: "bd-status-count bd-playlist-count" });

			progressBar = entriesList.createEl("progress", { cls: "bd-playlist-progress-bar bd-progress-bar" });
			progressBar.setAttr("max", "100");
			progressBar.setAttr("value", "0");

			const cardsContainer = entriesList.createDiv({ cls: "bd-playlist-cards-container" });
			
			const sortedIndices = Array.from(this.selectedPlaylistIndices).sort((a,b) => a - b);
			for (let i = 0; i < sortedIndices.length; i++) {
				const entryIndex = sortedIndices[i] - 1;
				const entry = this.videoInfo.entries[entryIndex];
				if (!entry) continue;

				const card = cardsContainer.createDiv({ cls: "bd-media-item" });
				
				const thumbContainer = card.createDiv({ cls: "bd-media-thumb-container" });
				if (entry.thumbnail) {
					thumbContainer.createEl("img", { cls: "bd-media-thumb", attr: { src: entry.thumbnail } });
				}
				if (entry.duration) {
					thumbContainer.createDiv({
						cls: "bd-duration-badge bd-duration-small",
						text: formatDuration(entry.duration),
					});
				}
				
				const meta = card.createDiv({ cls: "bd-media-meta" });
				meta.createEl("h4", { cls: "bd-media-title", text: entry.title });
				meta.createEl("span", { cls: "bd-media-channel", text: entry.channel });
				
				const statusContainer = card.createDiv({ cls: "bd-media-action" });
				const cardStatusIcon = statusContainer.createSpan({ cls: "bd-download-status-icon bd-text-muted" });
				setIcon(cardStatusIcon, "clock");

				const cardProgress = card.createEl("progress", { cls: "bd-card-progress-bottom", attr: { max: "100", value: "0" } });
				cardProgress.hide();
				
				playlistCards.set(i + 1, {
					container: card,
					progressBar: cardProgress,
					statusIcon: cardStatusIcon
				});
			}
		} else {
			// Single Video Card - Restore original large card
			const card = this.downloadingContainer.createDiv({ cls: "bd-video-card" });

			if (this.videoInfo.thumbnail) {
				const thumbContainer = card.createDiv({ cls: "bd-thumb-container" });
				const thumb = thumbContainer.createEl("img", {
					cls: "bd-thumbnail",
				});
				thumb.src = this.videoInfo.thumbnail;

				if (this.videoInfo.duration) {
					thumbContainer.createDiv({
						cls: "bd-duration-badge",
						text: formatDuration(this.videoInfo.duration),
					});
				}
			}

			progressBar = card.createEl("progress", { cls: "bd-playlist-progress-bar bd-progress-bar" });
			progressBar.setAttr("max", "100");
			progressBar.setAttr("value", "0");

			const meta = card.createDiv({ cls: "bd-video-meta" });
			meta.createEl("h3", { text: this.videoInfo.title, cls: "bd-video-title" });

			const details = meta.createDiv({ cls: "bd-video-details" });
			details.createEl("span", {
				text: this.videoInfo.channel || "",
				cls: "bd-detail bd-channel-detail",
			});

			const progressSection = meta.createDiv({ cls: "bd-progress-section" });
			
			const progressDetails = progressSection.createDiv({ cls: "bd-progress-details" });
			paramsEl = progressDetails.createEl("span", { text: "— | — | —", cls: "bd-progress-detail" });
			
			const statusText = progressSection.createDiv({ cls: "bd-progress-status" });
			statusIcon = statusText.createSpan({ cls: "bd-status-icon bd-text-muted" });
			setIcon(statusIcon, "clock-3");
			statusMsg = statusText.createSpan();

			// We don't strictly need a card progress bar since the global one is inside the card
			const dummyProgress = document.createElement("progress");
			playlistCards.set(1, {
				container: card,
				progressBar: dummyProgress,
				statusIcon: statusIcon
			});
		}

		// Cancel button
		const btnRow = this.downloadingContainer.createDiv({ cls: "bd-btn-row" });
		const cancelBtn = btnRow.createEl("button", {
			text: "Отменить",
			cls: "bd-cancel-btn mod-warning",
		});


		// Listen for progress
		const onProgress = (progress: DownloadProgress) => {
			progressBar.setAttr("value", progress.percent.toString());

			const updateCard = (percent?: number, colorClass?: string, icon?: string, iconAnim?: string) => {
				const idx = progress.playlistIndex || 1;
				if (playlistCards.has(idx)) {
					const cardElements = playlistCards.get(idx)!;
					
					if (colorClass) {
						cardElements.statusIcon.className = "bd-download-status-icon";
						cardElements.statusIcon.addClass(colorClass);
					}

					if (percent !== undefined) {
						if (percent === -1) {
							cardElements.progressBar.hide();
							cardElements.progressBar.removeAttribute("value");
						} else {
							cardElements.progressBar.show();
							cardElements.progressBar.setAttr("value", percent.toString());
						}
					}

					if (icon) {
						cardElements.statusIcon.empty();
						setIcon(cardElements.statusIcon, icon);
						if (iconAnim) {
							(cardElements.statusIcon.firstChild as HTMLElement)?.addClass(iconAnim);
						}
					}
					
					// Just add the active class, don't remove from others so concurrent downloads both look active
					cardElements.container.addClass("bd-card-active");
				}
			};

			switch (progress.status) {
				case "downloading": {
					statusIcon.empty();
					let isPlaylistMsg = false;
					if (progress.playlistIndex && progress.playlistCount) {
						isPlaylistMsg = true;
						updateCard(progress.itemPercent || progress.percent, "bd-text-accent", "download");
					}
					
					statusMsg.empty();
					if (isPlaylistMsg && playlistCountEl) {
						playlistCountEl.setText(`${progress.playlistIndex}/${progress.playlistCount}`);
					}
					statusMsg.createSpan({ text: `${progress.percent.toFixed(1)}%`, cls: "bd-status-percent" });
					
					paramsEl.setText(`${progress.speed} | ${progress.eta} | ${progress.totalSize}`);
					break;
				}
				case "merging":
				case "converting": {
					let isPlaylistMsg = false;
					if (progress.playlistIndex && progress.playlistCount) {
						isPlaylistMsg = true;
					}

					if (!isPlaylistMsg) {
						statusIcon.empty();
						setIcon(statusIcon, "loader");
						(statusIcon.firstChild as HTMLElement)?.addClass("bd-spin-anim");
						statusMsg.empty();
						progressBar.removeAttribute("value"); // indeterminate state
					} else {
						progressBar.setAttr("value", progress.percent.toString());
						statusMsg.empty();
						if (playlistCountEl) {
							playlistCountEl.setText(`${progress.playlistIndex}/${progress.playlistCount}`);
						}
						statusMsg.createSpan({ text: `${progress.percent.toFixed(1)}%`, cls: "bd-status-percent" });
					}
					
					updateCard(undefined, "bd-text-accent", "loader", "bd-spin-anim");
					break;
				}
				case "item_finished": {
					// When a single item in the pipeline fully finishes
					updateCard(-1, "bd-text-accent", "check-circle"); // -1 to hide progress bar
					
					// Make sure we remove active state from it so it looks complete
					const idx = progress.playlistIndex || 1;
					if (playlistCards.has(idx)) {
						playlistCards.get(idx)!.container.removeClass("bd-card-active");
					}
					break;
				}
				case "finished":
					statusIcon.empty();
					statusIcon.className = "bd-status-icon bd-text-accent";
					setIcon(statusIcon, "check-circle");
					statusMsg.empty();
					progressBar.setAttr("value", "100");
					cancelBtn.setText("Скачать другое");
					cancelBtn.removeClass("mod-warning");
					cancelBtn.addClass("mod-cta");
					if (progress.playlistIndex && playlistCards.has(progress.playlistIndex)) {
						updateCard(-1, "bd-text-accent", "check-circle");
					} else {
						// Mark all cards as complete if it's a global finish
						playlistCards.forEach(c => {
							c.statusIcon.className = "bd-download-status-icon bd-text-accent";
							c.statusIcon.empty();
							setIcon(c.statusIcon, "check-circle");
							c.progressBar.hide();
							c.container.removeClass("bd-card-active");
						});
					}
					break;
				case "error": {
					statusIcon.empty();
					setIcon(statusIcon, "alert-circle");
					(statusIcon.firstChild as HTMLElement)?.addClass("bd-icon-error");
					statusMsg.setText("Ошибка");
					progressBar.addClass("bd-progress-error");
					cancelBtn.setText("Назад");
					updateCard(undefined, "bd-text-red", "alert-circle");
					break;
				}
			}
		};

		this.downloadManager.on("progress", onProgress);

		cancelBtn.addEventListener("click", () => {
			if (this.downloadManager.isDownloading) {
				this.downloadManager.cancelDownload();
				cancelBtn.setText("Скачать другое");
				cancelBtn.removeClass("mod-warning");
				cancelBtn.addClass("mod-cta");
			} else {
				// Clicked "Download Another" or "Back" -> Reset View entirely
				this.urlInput.value = "";
				this.urlInput.disabled = false;
				this.downloadingContainer.hide();
				this.selectionContainer.hide();
				this.emptyState.show();
				this.emptyState.addClass("bd-fade-in");
				this.urlInput.focus();
				this.downloadManager.removeAllListeners("progress");
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
			thumbnailPath: path.join(this.vaultPath, this.plugin.settings.thumbnailPath),
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

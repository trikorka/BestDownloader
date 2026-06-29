import { App, PluginSettingTab, Setting, Notice, FileSystemAdapter } from "obsidian";
import type BestDownloaderPlugin from "./main";
import { VideoFormat, VideoQuality, AudioFormat } from "./types";
import { AutoDownloader } from "./auto-downloader";
import * as fs from "fs";
import * as path from "path";

export class BestDownloaderSettingTab extends PluginSettingTab {
	plugin: BestDownloaderPlugin;

	constructor(app: App, plugin: BestDownloaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Best Downloader")
			.setDesc("Настройки плагина для загрузки YouTube видео и аудио.")
			.setHeading();

		// --- Dependencies ---
		new Setting(containerEl).setName("Зависимости (Бинарные файлы)").setHeading();
		
		const basePath = this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : ".";
		const pluginDir = path.join(basePath, this.app.vault.configDir, "plugins", this.plugin.manifest.id);
		const binDir = path.join(pluginDir, "bin");

		const depDesc = activeDocument.createDocumentFragment();
		depDesc.append(
			"Для работы плагина требуются ",
			depDesc.createEl("a", { href: "https://github.com/yt-dlp/yt-dlp/releases/latest", text: "yt-dlp" }),
			" и ",
			depDesc.createEl("a", { href: "https://www.gyan.dev/ffmpeg/builds/", text: "ffmpeg" }),
			". Скачайте их и поместите исполняемые файлы (yt-dlp.exe и ffmpeg.exe) в папку ",
			depDesc.createEl("code", { text: "bin" }),
			" внутри папки этого плагина."
		);

		new Setting(containerEl)
			.setName("Проверка зависимостей")
			.setDesc(depDesc)
			.addButton((btn) => {
				btn.setButtonText("Проверить наличие");
				btn.onClick(() => {
					const isWin = process.platform === "win32";
					const ytDlpPath = path.join(binDir, isWin ? "yt-dlp.exe" : "yt-dlp");
					const ffmpegPath = path.join(binDir, isWin ? "ffmpeg.exe" : "ffmpeg");
					
					const ytDlpExists = fs.existsSync(ytDlpPath);
					const ffmpegExists = fs.existsSync(ffmpegPath);

					if (ytDlpExists && ffmpegExists) {
						btn.setButtonText("Проверить наличие ✅");
						new Notice("Зависимости найдены и готовы к работе!");
					} else {
						btn.setButtonText("Проверить наличие ❌");
						new Notice(`yt-dlp: ${ytDlpExists ? "✅" : "❌"}, ffmpeg: ${ffmpegExists ? "✅" : "❌"}`);
					}
				});
			});

		new Setting(containerEl)
			.setName("Автозагрузка")
			.setDesc("Скачать yt-dlp и ffmpeg автоматически (только Windows)")
			.addButton((btn) => {
				btn.setButtonText("Скачать автоматически");
				btn.onClick(async () => {
					new Notice("Предупреждение: Вы скачиваете исполняемые файлы (yt-dlp и ffmpeg) со сторонних серверов (GitHub). Вы делаете это на свой страх и риск.", 8000);
					
					btn.setDisabled(true);
					
					// Create binDir if not exists
					if (!fs.existsSync(binDir)) {
						fs.mkdirSync(binDir, { recursive: true });
					}

					try {
						await AutoDownloader.downloadYtDlp(binDir, (msg) => {
							btn.setButtonText(msg);
						});
						await AutoDownloader.downloadFfmpeg(binDir, (msg) => {
							btn.setButtonText(msg);
						});
						
						btn.setButtonText("Готово ✅");
						new Notice("Зависимости успешно скачаны!");
					} catch (e) {
						console.error("Download error:", e);
						btn.setButtonText("Ошибка скачивания ❌");
						new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`, 8000);
					} finally {
						btn.setDisabled(false);
						window.setTimeout(() => {
							if (btn.buttonEl.innerText.includes("✅") || btn.buttonEl.innerText.includes("❌")) {
								btn.setButtonText("Скачать автоматически");
							}
						}, 3000);
					}
				});
			});

		// --- Download Path ---
		new Setting(containerEl).setName("Загрузка").setHeading();

		new Setting(containerEl)
			.setName("Папка загрузок")
			.setDesc(
				"Путь к папке внутри vault, куда будут сохраняться файлы"
			)
			.addText((text) =>
				text
					.setPlaceholder("downloads")
					.setValue(this.plugin.settings.downloadPath)
					.onChange(async (value) => {
						this.plugin.settings.downloadPath =
							value || "downloads";
						await this.plugin.saveSettings();
					})
			);

		// --- Default Formats ---
		new Setting(containerEl).setName("Форматы по умолчанию").setHeading();

		new Setting(containerEl)
			.setName("Формат видео")
			.setDesc("Формат видео по умолчанию")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						mp4: "MP4",
						webm: "WebM",
						mkv: "MKV",
					})
					.setValue(this.plugin.settings.defaultVideoFormat)
					.onChange(async (value) => {
						this.plugin.settings.defaultVideoFormat =
							value as VideoFormat;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Качество видео")
			.setDesc("Качество видео по умолчанию")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"360": "360p",
						"480": "480p",
						"720": "720p (HD)",
						"1080": "1080p (Full HD)",
						"1440": "1440p (2K)",
						"2160": "2160p (4K)",
						best: "Лучшее доступное",
					})
					.setValue(this.plugin.settings.defaultVideoQuality)
					.onChange(async (value) => {
						this.plugin.settings.defaultVideoQuality =
							value as VideoQuality;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Формат аудио")
			.setDesc("Формат аудио по умолчанию")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						mp3: "MP3",
						m4a: "M4A",
						ogg: "OGG",
						wav: "WAV",
						opus: "Opus",
					})
					.setValue(this.plugin.settings.defaultAudioFormat)
					.onChange(async (value) => {
						this.plugin.settings.defaultAudioFormat =
							value as AudioFormat;
						await this.plugin.saveSettings();
					})
			);

		// --- Note Creation ---
		new Setting(containerEl).setName("Заметки").setHeading();

		new Setting(containerEl)
			.setName("Создавать заметку")
			.setDesc(
				"Автоматически создавать markdown-заметку с метаданными видео"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.createNote)
					.onChange(async (value) => {
						this.plugin.settings.createNote = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Advanced ---
		new Setting(containerEl).setName("Дополнительно").setHeading();

		new Setting(containerEl)
			.setName("Имитация браузера")
			.setDesc("Включите, если появляется ошибка загрузки")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.impersonateBrowser)
					.onChange(async (value) => {
						this.plugin.settings.impersonateBrowser = value;
						await this.plugin.saveSettings();
					})
			);

	}
}

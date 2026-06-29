import { App, Modal, Notice, setIcon } from "obsidian";
import BestDownloaderPlugin from "./main";
import { AutoDownloader } from "./auto-downloader";
import * as fs from "fs";
import * as path from "path";

export class OnboardingModal extends Modal {
	plugin: BestDownloaderPlugin;
	currentSlide: number = 0;
	slides: HTMLElement[] = [];
	contentContainer: HTMLElement;
	controlsContainer: HTMLElement;

	constructor(app: App, plugin: BestDownloaderPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("bd-onboarding-modal");

		this.titleEl.setText("Добро пожаловать в Best Downloader!");
		
		this.contentContainer = contentEl.createDiv({ cls: "bd-onboarding-content" });
		this.controlsContainer = contentEl.createDiv({ cls: "bd-onboarding-controls" });

		this.buildSlides();
		this.renderSlide();
	}

	buildSlides() {
		this.slides = [];

		// Slide 1: Welcome
		const slide1 = createDiv({ cls: "bd-slide" });
		slide1.createEl("h2", { text: "Скачивайте видео и аудио прямо в Obsidian" });
		slide1.createEl("p", { text: "Best Downloader позволяет вам загружать видеоролики и аудиофайлы с YouTube и сотен других сайтов прямо в ваше локальное хранилище Obsidian. Вы можете сохранять лекции, музыку и подкасты для офлайн-доступа." });
		
		const featuresList = slide1.createEl("ul");
		featuresList.createEl("li", { text: "Скачивание в высоком качестве (до 4K)" });
		featuresList.createEl("li", { text: "Автоматическое извлечение аудио (M4A, MP3, Opus)" });
		featuresList.createEl("li", { text: "Автоматическое создание заметок к скачанным видео" });
		this.slides.push(slide1);

		// Slide 2: How to use
		const slide2 = createDiv({ cls: "bd-slide" });
		slide2.createEl("h2", { text: "Как использовать" });
		slide2.createEl("p", { text: "Использовать плагин очень просто:" });
		const stepsList = slide2.createEl("ol");
		stepsList.createEl("li", { text: "Откройте боковую панель Best Downloader (иконка скачивания на панели слева или через палитру команд)." });
		stepsList.createEl("li", { text: "Вставьте ссылку на видео или плейлист." });
		stepsList.createEl("li", { text: "Выберите нужный формат и качество." });
		stepsList.createEl("li", { text: "Нажмите 'Скачать' и дождитесь завершения!" });
		this.slides.push(slide2);

		// Slide 3: Dependencies (Manual)
		const slide3 = createDiv({ cls: "bd-slide" });
		slide3.createEl("h2", { text: "Требования к системе" });
		slide3.createEl("p", { text: "Под капотом плагин использует мощные утилиты yt-dlp и ffmpeg. Без них скачивание работать не будет." });
		slide3.createEl("p", { text: "Вы можете установить их самостоятельно:" });
		const manualList = slide3.createEl("ul");
		manualList.createEl("li", { text: "Скачайте yt-dlp.exe и ffmpeg.exe с их официальных сайтов (GitHub)." });
		manualList.createEl("li", { text: "Поместите эти файлы в папку .obsidian/plugins/best-downloader/bin/ внутри вашего хранилища." });
		this.slides.push(slide3);

		// Slide 4: Auto-download
		const slide4 = createDiv({ cls: "bd-slide" });
		slide4.createEl("h2", { text: "Автоматическая загрузка" });
		slide4.createEl("p", { text: "Или плагин может скачать всё сам прямо сейчас! (Около 150 МБ)." });
		
		const autoDownloadBtnContainer = slide4.createDiv({ cls: "bd-auto-download-container" });
		const autoBtn = autoDownloadBtnContainer.createEl("button", { 
			text: "Скачать зависимости автоматически",
			cls: "mod-cta bd-auto-btn"
		});

		autoBtn.addEventListener("click", () => {
			new Notice("Загрузка исполняемых файлов со сторонних серверов (GitHub)...", 4000);
			autoBtn.disabled = true;
			
			const basePath = this.app.vault.adapter.hasOwnProperty('getBasePath') ? (this.app.vault.adapter as any).getBasePath() : ".";
			const pluginDir = path.join(basePath, this.app.vault.configDir, "plugins", this.plugin.manifest.id);
			const binDir = path.join(pluginDir, "bin");

			if (!fs.existsSync(binDir)) {
				fs.mkdirSync(binDir, { recursive: true });
			}

			// Run asynchronously without blocking UI
			(async () => {
				try {
					await AutoDownloader.downloadYtDlp(binDir, (msg) => {
						autoBtn.innerText = msg;
					});
					await AutoDownloader.downloadFfmpeg(binDir, (msg) => {
						autoBtn.innerText = msg;
					});
					
					autoBtn.innerText = "Установлено ✅";
					autoBtn.addClass("bd-success-btn");
					new Notice("Зависимости успешно скачаны!");
				} catch (e) {
					console.error("Download error:", e);
					autoBtn.innerText = "Ошибка скачивания ❌";
					new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`, 8000);
					autoBtn.disabled = false;
				}
			})();
		});

		slide4.createEl("p", { text: "Вы всегда сможете скачать их позже в настройках плагина.", cls: "bd-muted-text" });
		this.slides.push(slide4);
	}

	renderSlide() {
		this.contentContainer.empty();
		this.contentContainer.appendChild(this.slides[this.currentSlide]);

		this.controlsContainer.empty();

		const prevBtn = this.controlsContainer.createEl("button", { text: "Назад" });
		prevBtn.disabled = this.currentSlide === 0;
		prevBtn.addEventListener("click", () => {
			if (this.currentSlide > 0) {
				this.currentSlide--;
				this.renderSlide();
			}
		});

		// Dots indicator
		const dotsContainer = this.controlsContainer.createDiv({ cls: "bd-slider-dots" });
		for (let i = 0; i < this.slides.length; i++) {
			const dot = dotsContainer.createDiv({ cls: "bd-dot" });
			if (i === this.currentSlide) dot.addClass("is-active");
		}

		if (this.currentSlide < this.slides.length - 1) {
			const nextBtn = this.controlsContainer.createEl("button", { text: "Далее", cls: "mod-cta" });
			nextBtn.addEventListener("click", () => {
				this.currentSlide++;
				this.renderSlide();
			});
		} else {
			const finishBtn = this.controlsContainer.createEl("button", { text: "Начать использование!", cls: "mod-cta" });
			finishBtn.addEventListener("click", async () => {
				await this.finishOnboarding();
			});
		}
	}

	async finishOnboarding() {
		this.plugin.settings.hasCompletedOnboarding = true;
		await this.plugin.saveSettings();
		this.close();
		new Notice("Удачного скачивания!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// If they closed by clicking outside, we also mark it as completed so it doesn't pop up again
		if (!this.plugin.settings.hasCompletedOnboarding) {
			this.plugin.settings.hasCompletedOnboarding = true;
			this.plugin.saveSettings().catch(console.error);
		}
	}
}

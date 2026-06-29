import { requestUrl } from "obsidian";
import * as fs from "fs";
import * as path from "path";
// @ts-ignore
import AdmZip from "adm-zip";

export class AutoDownloader {
	static async downloadYtDlp(binDir: string, onProgress: (msg: string) => void): Promise<void> {
		const ytDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
		const destPath = path.join(binDir, "yt-dlp.exe");

		onProgress("Скачивание yt-dlp...");
		await this.downloadFile(ytDlpUrl, destPath);
	}

	static async downloadFfmpeg(binDir: string, onProgress: (msg: string) => void): Promise<void> {
		const ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
		const zipPath = path.join(binDir, "ffmpeg.zip");

		onProgress("Скачивание ffmpeg (около 130 МБ)...");
		await this.downloadFile(ffmpegUrl, zipPath);

		onProgress("Распаковка ffmpeg...");
		await this.extractFfmpeg(zipPath, binDir);

		// Remove the zip file
		try {
			if (fs.existsSync(zipPath)) {
				fs.unlinkSync(zipPath);
			}
		} catch (e) {
			console.error("Не удалось удалить архив ffmpeg.zip:", e);
		}
	}

	private static async downloadFile(url: string, dest: string): Promise<void> {
		try {
			const response = await requestUrl({
				url: url,
				method: "GET"
			});

			if (response.status !== 200) {
				throw new Error(`Ошибка скачивания: статус ${response.status}`);
			}

			fs.writeFileSync(dest, Buffer.from(response.arrayBuffer));
		} catch (err) {
			if (fs.existsSync(dest)) {
				fs.unlinkSync(dest);
			}
			throw err;
		}
	}

	private static async extractFfmpeg(zipPath: string, destDir: string): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- AdmZip has no strict types
				const zip = new AdmZip(zipPath);
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- AdmZip has no strict types
				const zipEntries: Array<{ entryName: string; getData: () => Buffer }> = zip.getEntries();
				let found = false;

				for (const entry of zipEntries) {
					// We only want ffmpeg.exe from the bin directory
					if (entry.entryName.endsWith("bin/ffmpeg.exe")) {
						const content: Buffer = entry.getData();
						fs.writeFileSync(path.join(destDir, "ffmpeg.exe"), content);
						found = true;
						break;
					}
				}

				if (!found) {
					reject(new Error("Не найден ffmpeg.exe в скачанном архиве"));
				} else {
					resolve();
				}
			} catch (e) {
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		});
	}
}

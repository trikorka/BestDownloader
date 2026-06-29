import { DownloadProgress } from "./types";

/**
 * Validates if a given string is a valid YouTube URL
 */
export function isValidYouTubeUrl(url: string): boolean {
	const patterns = [
		/^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
		/^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
		/^(https?:\/\/)?youtu\.be\/[\w-]{11}/,
		/^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]{11}/,
		/^(https?:\/\/)?(www\.)?youtube\.com\/v\/[\w-]{11}/,
		/^(https?:\/\/)?(www\.)?youtube\.com\/playlist\?list=[\w-]+/,
	];
	return patterns.some((p) => p.test(url.trim()));
}

/**
 * Extracts video ID from a YouTube URL
 */
export function extractVideoId(url: string): string | null {
	const patterns = [
		/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([\w-]{11})/,
	];
	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) return match[1];
	}
	return null;
}

/**
 * Parses yt-dlp progress output line into structured data.
 * Expected format from --progress-template:
 * {"percent":"50.0%","total":"100MiB","speed":"5.0MiB/s","eta":"00:10"}
 */
export function parseProgress(line: string): DownloadProgress | null {
	// Try JSON format first (from --progress-template)
	try {
		const data = JSON.parse(line.trim());
		if (data.percent !== undefined) {
			return {
				percent: parseFloat(String(data.percent).replace("%", "")) || 0,
				totalSize: data.total || "N/A",
				speed: data.speed || "N/A",
				eta: data.eta || "N/A",
				status: "downloading",
			};
		}
	} catch {
		// Not JSON, try regex parsing
	}

	// Regex for standard yt-dlp output with --newline
	// [download]  45.2% of  150.00MiB at    5.20MiB/s ETA 00:15
	const downloadMatch = line.match(
		/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+([\d:]+)/
	);
	if (downloadMatch) {
		return {
			percent: parseFloat(downloadMatch[1]),
			totalSize: downloadMatch[2],
			speed: downloadMatch[3],
			eta: downloadMatch[4],
			status: "downloading",
		};
	}

	// [download] 100% of 150.00MiB in 00:30
	const completeMatch = line.match(
		/\[download\]\s+100%\s+of\s+~?([\d.]+\w+)/
	);
	if (completeMatch) {
		return {
			percent: 100,
			totalSize: completeMatch[1],
			speed: "—",
			eta: "0:00",
			status: "downloading",
		};
	}

	// [Merger] Merging formats
	if (line.includes("[Merger]") || line.includes("[ffmpeg]")) {
		return {
			percent: 100,
			totalSize: "—",
			speed: "—",
			eta: "—",
			status: "merging",
		};
	}

	// [ExtractAudio] / conversion
	if (line.includes("[ExtractAudio]") || line.includes("Converting")) {
		return {
			percent: 100,
			totalSize: "—",
			speed: "—",
			eta: "—",
			status: "converting",
		};
	}

	return null;
}

/**
 * Formats seconds into human-readable duration string
 * e.g. 3661 -> "1:01:01", 125 -> "2:05"
 */
export function formatDuration(seconds: number): string {
	if (!seconds || seconds <= 0) return "0:00";

	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	if (h > 0) {
		return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
	}
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Formats bytes into human-readable size string
 * e.g. 1048576 -> "1.0 MB"
 */
export function formatFileSize(bytes: number): string {
	if (!bytes || bytes <= 0) return "N/A";

	const units = ["B", "KB", "MB", "GB", "TB"];
	let unitIndex = 0;
	let size = bytes;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Sanitizes a filename by removing or replacing invalid characters
 */
export function sanitizeFilename(name: string): string {
	return name
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
		.replace(/\s+/g, " ")
		.trim()
		.substring(0, 200);
}

/**
 * Returns the current platform
 */
export function getPlatform(): "win32" | "darwin" | "linux" {
	return process.platform as "win32" | "darwin" | "linux";
}

/**
 * Returns current date in YYYY-MM-DD format
 */
export function getCurrentDate(): string {
	const d = new Date();
	return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

/**
 * Replaces template variables in a note template
 */
export function applyNoteTemplate(
	template: string,
	vars: Record<string, string>
): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
	}
	return result;
}

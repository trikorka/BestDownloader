export interface PluginSettings {
	downloadPath: string;
	defaultVideoFormat: VideoFormat;
	defaultVideoQuality: VideoQuality;
	defaultAudioFormat: AudioFormat;
	createNote: boolean;
	noteTemplate: string;
	impersonateBrowser: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	downloadPath: "downloads",
	defaultVideoFormat: "mp4",
	defaultVideoQuality: "1080",
	defaultAudioFormat: "m4a",
	createNote: false,
	impersonateBrowser: false,
	noteTemplate: `---
title: "{{title}}"
channel: "{{channel}}"
duration: "{{duration}}"
url: "{{url}}"
downloaded: "{{date}}"
---

# {{title}}

**Канал:** {{channel}}
**Длительность:** {{duration}}
**URL:** [{{url}}]({{url}})

{{description}}
`,
};

export type VideoFormat = "mp4" | "webm" | "mkv";
export type AudioFormat = "mp3" | "m4a" | "wav" | "opus";
export type VideoQuality = "144" | "240" | "360" | "480" | "720" | "1080" | "1440" | "2160" | "best";
export type DownloadType = "video" | "audio";

export interface VideoInfo {
	id: string;
	title: string;
	description: string;
	thumbnail: string;
	duration: number;
	channel: string;
	upload_date: string;
	view_count: number;
	like_count: number;
	formats: FormatInfo[];
	webpage_url: string;
	filesize_approx?: number;
	isPlaylist?: boolean;
	playlistCount?: number;
	entries?: PlaylistEntry[];
}

export interface PlaylistEntry {
	id: string;
	title: string;
	thumbnail: string;
	duration: number;
	channel: string;
}

export interface FormatInfo {
	format_id: string;
	format_note: string;
	ext: string;
	resolution: string;
	filesize: number | null;
	vcodec: string;
	acodec: string;
	height: number | null;
	width: number | null;
	tbr: number | null;
}

export interface DownloadOptions {
	url: string;
	type: DownloadType;
	videoFormat: VideoFormat;
	videoQuality: VideoQuality;
	audioFormat: AudioFormat;
	outputPath: string;
	filename?: string;
	isPlaylist?: boolean;
	playlistItems?: number[];
}

export interface DownloadProgress {
	percent: number;
	totalSize: string;
	speed: string;
	eta: string;
	status: "downloading" | "converting" | "merging" | "finished" | "error";
	filename?: string;
	playlistIndex?: number;
	playlistCount?: number;
}

export interface DependencyStatus {
	ytDlp: boolean;
	ffmpeg: boolean;
	ytDlpVersion?: string;
}

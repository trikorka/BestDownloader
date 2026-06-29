# Best Downloader

An Obsidian plugin to download videos and audio directly into your vault, powered by `yt-dlp`.

**Note:** This plugin works only on the Obsidian desktop app (Windows, macOS, Linux).

## Features

- Download videos from hundreds of sites supported by `yt-dlp`.
- Download audio-only (MP3/M4A) or video+audio (MP4/WebM).
- Automatically saves downloaded files directly into your Obsidian vault.
- Customizable download paths.

## Requirements

- **Obsidian Desktop App**: The plugin requires the desktop version of Obsidian. It does not work on mobile.
- **yt-dlp**: Make sure you have `yt-dlp` installed and available in your system's PATH, or specify the executable path in the plugin settings.
- **FFmpeg**: Required if you want `yt-dlp` to mux video and audio streams together or convert audio formats.

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings.
2. Go to **Community plugins** and disable Safe mode.
3. Click **Browse** and search for "Best Downloader".
4. Install and enable the plugin.

### Manual Installation

1. Go to the [Releases](https://github.com/trikorka/BestDownloader/releases) page of this repository.
2. Download `main.js`, `manifest.json`, and `styles.css` (if present) from the latest release.
3. Create a folder named `best-downloader` inside your Obsidian vault's `.obsidian/plugins/` directory.
4. Place the downloaded files into the `best-downloader` folder.
5. Restart Obsidian or reload plugins.
6. Enable the plugin in Settings > Community plugins.

## Usage

1. Open the Command Palette (`Ctrl+P` or `Cmd+P`).
2. Search for **Best Downloader** and select the download command.
3. Enter the URL of the video you want to download.
4. Choose the format (Audio/Video).
5. The file will be downloaded and saved to your vault.

## Settings

In the plugin settings, you can configure:
- **Download Path**: The folder in your vault where downloads will be saved.
- **yt-dlp Path**: The absolute path to your `yt-dlp` executable (optional, if it's already in your system PATH).
- **Default Format**: Choose whether to download Audio or Video by default.

## License

This project is licensed under the [MIT License](LICENSE).

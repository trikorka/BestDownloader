import { App, Modal } from "obsidian";

export class ConfirmModal extends Modal {
	title: string;
	message: string;
	onConfirm: () => void;

	constructor(app: App, title: string, message: string, onConfirm: () => void) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl("h2", { text: this.title });
		
		const msgEl = contentEl.createEl("p", { text: this.message, cls: "bd-pre-wrap" });

		const btnContainer = contentEl.createDiv({ cls: "bd-confirm-btns" });

		const cancelBtn = btnContainer.createEl("button", { text: "Отмена" });
		cancelBtn.addEventListener("click", () => {
			this.close();
		});

		const confirmBtn = btnContainer.createEl("button", { text: "Подтверждаю", cls: "mod-warning" });
		confirmBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

import * as vscode from "vscode"
import { readUserKeybindings, getDefaultKeybindings } from "./vscode-config"

type KeybindingEntry = {
	key?: string
	command?: string
	when?: string
	args?: any
}

/**
 * Gets the current keybinding label for a command, reading from user's keybindings.json
 * and falling back to the extension's default keybinding from package.json
 */
export async function getCurrentKeybindingLabel(
	commandId: string,
	context: vscode.ExtensionContext,
): Promise<string | undefined> {
	try {
		const userKeybindings = await readUserKeybindings()
		const userBinding = findFirstBindingForCommand(userKeybindings, commandId)
		const contributedKeybindings: KeybindingEntry[] = getDefaultKeybindings(context)
		const defaultBinding = contributedKeybindings.find((k: KeybindingEntry) => k.command === commandId)

		const rawKey = (userBinding?.key ?? defaultBinding?.key)?.trim()
		if (!rawKey) return undefined

		return prettyPrintKey(rawKey, process.platform)
	} catch (error) {
		console.warn(`Failed to get keybinding for command ${commandId}:`, error)
		return undefined
	}
}

/**
 * Finds the first keybinding entry for a given command
 */
function findFirstBindingForCommand(entries: KeybindingEntry[], commandId: string): KeybindingEntry | undefined {
	// Note: This doesn't evaluate "when" clauses or handle removals
	// For a more complete implementation, you'd need to process the full keybinding resolution logic
	return entries.find((entry) => entry.command === commandId && entry.key && entry.key.trim())
}

/**
 * Formats a raw keybinding string into a human-readable format
 */
function prettyPrintKey(rawKey: string, platform: NodeJS.Platform): string {
	// Handle chord keybindings like "ctrl+k, ctrl+s"
	const chords = rawKey.split(" ").filter(Boolean)

	const formattedChords = chords.map((chord) => {
		const parts = chord.split("+")
		return parts.map((part) => normalizeKeyToken(part, platform)).join("+")
	})

	// Join chords with comma for VS Code-style display
	if (formattedChords.length > 1) {
		return formattedChords.join(", ")
	}

	return formattedChords[0] || ""
}

/**
 * Normalizes individual key tokens for platform-specific display
 */
function normalizeKeyToken(token: string, platform: NodeJS.Platform): string {
	const normalized = token.toLowerCase()
	const isMac = platform === "darwin"

	// Platform-specific modifier mappings
	const macModifiers: Record<string, string> = {
		cmd: "Cmd",
		meta: "Cmd",
		ctrl: "Ctrl", // Control key on macOS should display as Ctrl, not Cmd
		alt: "Option",
		option: "Option",
		shift: "Shift",
	}

	const winLinuxModifiers: Record<string, string> = {
		cmd: "Ctrl", // Users sometimes use cmd in keybindings.json on Windows/Linux
		meta: "Win",
		ctrl: "Ctrl",
		alt: "Alt",
		shift: "Shift",
	}

	const modifierMap = isMac ? macModifiers : winLinuxModifiers

	if (normalized in modifierMap) {
		return modifierMap[normalized]
	}

	// Handle special keys
	const specialKeys: Record<string, string> = {
		left: "Left",
		right: "Right",
		up: "Up",
		down: "Down",
		home: "Home",
		end: "End",
		pageup: "PageUp",
		pagedown: "PageDown",
		insert: "Insert",
		delete: "Delete",
		backspace: "Backspace",
		tab: "Tab",
		enter: "Enter",
		escape: "Escape",
		space: "Space",
	}

	if (normalized in specialKeys) {
		return specialKeys[normalized]
	}

	// Handle function keys
	if (/^f\d{1,2}$/.test(normalized)) {
		return normalized.toUpperCase()
	}

	// Handle single letters
	if (normalized.length === 1) {
		return normalized.toUpperCase()
	}

	// Default: title case
	return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

/**
 * Gets keybinding labels for multiple commands at once
 */
export async function getKeybindingLabels(
	commandIds: string[],
	context: vscode.ExtensionContext,
): Promise<Record<string, string | undefined>> {
	const result: Record<string, string | undefined> = {}

	for (const commandId of commandIds) {
		result[commandId] = await getCurrentKeybindingLabel(commandId, context)
	}

	return result
}

/**
 * Gets the platform-specific default keybinding for a command
 * @param baseKeybinding The base keybinding (e.g., "ctrl+shift+g")
 * @returns Platform-formatted keybinding (e.g., "Cmd+Shift+G" on macOS, "Ctrl+Shift+G" on Windows/Linux)
 */
export function getPlatformKeybinding(baseKeybinding: string): string {
	return prettyPrintKey(baseKeybinding, process.platform)
}

/**
 * Gets the platform-specific modifier key
 * @returns "Cmd" on macOS, "Ctrl" on Windows/Linux
 */
export function getPlatformModifier(): string {
	return process.platform === "darwin" ? "Cmd" : "Ctrl"
}

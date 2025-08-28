import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"
import JSON5 from "json5"
import { promises as fs } from "fs"

/**
 * VS Code configuration and file system utilities with robust fork support
 */

/** Early exit: you cannot read local keybindings from remote/web hosts. */
export function canReadLocalKeybindings(): boolean {
	// Remote (ssh, wsl, devcontainer) or Web (in browser) → keybindings live on client.
	// In these cases, show shortcuts via menus or open the Keybindings UI instead.
	// https://code.visualstudio.com/api/extension-guides/command
	return !vscode.env.remoteName && vscode.env.uiKind === vscode.UIKind.Desktop
}

/** Map env.appName → the folder name that holds User/keybindings.json */
function productDirName(): string {
	const name = vscode.env.appName || "" // e.g., "Visual Studio Code", "VSCodium", "Cursor", "Windsurf"
	const n = name.toLowerCase()

	// Most common products/forks
	if (n.includes("insiders")) return "Code - Insiders"
	if (n.includes("visual studio code")) return "Code"
	if (n.includes("vscodium")) return "VSCodium"
	if (n.includes("cursor")) return "Cursor"
	if (n.includes("windsurf")) return "Windsurf"
	if (n.includes("oss")) return "Code - OSS"

	// Fallback: try the VS Code default
	return "Code"
}

/** Resolve the base *user data* dir for the current product on this OS (not including /User). */
function getUserDataBaseDir(): string {
	// Portable installs:
	// VS Code recognizes VSCODE_PORTABLE; many forks mirror this.
	const portable = process.env.VSCODE_PORTABLE
	if (portable) return path.join(portable, "user-data")

	// If the app was launched with --user-data-dir=<dir>, there's no API to read it here.
	// We still fall back to the canonical locations.
	const home = os.homedir()
	const product = productDirName()

	if (process.platform === "win32") {
		const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming")
		return path.join(appdata, product)
	}

	if (process.platform === "darwin") {
		return path.join(home, "Library", "Application Support", product)
	}

	// Linux / *nix honors XDG base dir (what VS Code docs describe for settings)
	const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
	return path.join(xdg, product)
}

/** Return candidate absolute paths to keybindings.json (default + profiles). */
async function getKeybindingsCandidates(): Promise<string[]> {
	// Special case: code-server stores user data under ~/.local/share/code-server/User
	// https://coder.com/docs/code-server/FAQ
	if (!vscode.env.remoteName && (process.env.CODE_SERVER === "true" || process.env.VSCODE_PROXY_URI)) {
		const base = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "code-server")
		const user = path.join(base, "User")
		return await enumerateProfileKeybindings(user)
	}

	const baseDir = getUserDataBaseDir() // e.g., ~/Library/Application Support/Code
	const userDir = path.join(baseDir, "User") // …/User
	return await enumerateProfileKeybindings(userDir)
}

/** Include User/keybindings.json AND any User/profiles/<id>/keybindings.json (current profile not exposed; we'll pick best candidate). */
async function enumerateProfileKeybindings(userDir: string): Promise<string[]> {
	const candidates: string[] = []
	candidates.push(path.join(userDir, "keybindings.json"))

	try {
		const profilesDir = path.join(userDir, "profiles")
		const entries = await fs.readdir(profilesDir, { withFileTypes: true })
		for (const e of entries) {
			if (e.isDirectory()) {
				candidates.push(path.join(profilesDir, e.name, "keybindings.json"))
			}
		}
	} catch {
		// No profiles directory — that's fine.
	}

	// Filter to files that actually exist
	const existing: string[] = []
	for (const p of candidates) {
		try {
			const st = await fs.stat(p)
			if (st.isFile()) existing.push(p)
		} catch {
			/* ignore */
		}
	}
	// Heuristic: prefer the most recently modified among existing files.
	if (existing.length > 1) {
		const stats = await Promise.all(existing.map(async (p) => ({ path: p, stat: await fs.stat(p) })))
		stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
		return stats.map((s) => s.path)
	}
	return existing
}

/** Public: read user keybindings rules from the best candidate file (JSON5). */
export async function readUserKeybindings(): Promise<any[]> {
	if (!canReadLocalKeybindings()) return [] // remote/web → not readable here

	const candidates = await getKeybindingsCandidates()
	for (const filePath of candidates) {
		const rules = await readJSON5File(filePath)
		if (Array.isArray(rules)) return rules
	}
	return []
}

/** Read + parse a JSON5 file (with comments, trailing commas). */
export async function readJSON5File(filePath: string): Promise<any | null> {
	try {
		const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
		return JSON5.parse(Buffer.from(buf).toString("utf8"))
	} catch {
		return null
	}
}

/** Optional helper: where the "User" dir is (useful for logs / diagnostics). */
export async function getUserKeybindingsDirForDiagnostics(): Promise<string | undefined> {
	if (!canReadLocalKeybindings()) return undefined
	const baseDir = getUserDataBaseDir()
	return path.join(baseDir, "User")
}

/**
 * Get default keybindings from extension's package.json
 */
export function getDefaultKeybindings(context: vscode.ExtensionContext): any[] {
	const packageJSON = context.extension.packageJSON
	return packageJSON?.contributes?.keybindings || []
}

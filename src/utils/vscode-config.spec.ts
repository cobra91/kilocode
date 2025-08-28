import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import {
	canReadLocalKeybindings,
	readUserKeybindings,
	readJSON5File,
	getUserKeybindingsDirForDiagnostics,
	getDefaultKeybindings,
} from "./vscode-config"
import { promises as fs } from "fs"
import * as os from "os"

// Mock VS Code API
vi.mock("vscode", () => ({
	env: {
		appName: "Visual Studio Code",
		remoteName: undefined,
		uiKind: 1, // Desktop
	},
	UIKind: {
		Desktop: 1,
		Web: 2,
	},
	workspace: {
		fs: {
			readFile: vi.fn(),
		},
	},
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
	},
}))

// Mock Node.js fs promises
vi.mock("fs", () => ({
	promises: {
		readdir: vi.fn(),
		stat: vi.fn(),
	},
}))

// Mock os module
vi.mock("os", () => ({
	homedir: vi.fn(),
}))

// Mock process.platform and process.env
const originalPlatform = process.platform
const originalEnv = process.env

describe("vscode-config utilities", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset platform and env
		Object.defineProperty(process, "platform", {
			value: "darwin",
			configurable: true,
		})
		process.env = { ...originalEnv, HOME: "/mock/home" }

		// Reset VS Code env mocks
		vi.mocked(vscode.env).appName = "Visual Studio Code"
		vi.mocked(vscode.env).remoteName = undefined
		vi.mocked(vscode.env).uiKind = vscode.UIKind.Desktop

		// Mock os.homedir
		vi.mocked(os.homedir).mockReturnValue("/mock/home")
	})

	afterEach(() => {
		// Restore original values
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			configurable: true,
		})
		process.env = originalEnv
	})

	describe("canReadLocalKeybindings", () => {
		it("should return true for desktop environment", () => {
			vi.mocked(vscode.env).remoteName = undefined
			vi.mocked(vscode.env).uiKind = vscode.UIKind.Desktop

			const result = canReadLocalKeybindings()

			expect(result).toBe(true)
		})

		it("should return false for remote environment", () => {
			vi.mocked(vscode.env).remoteName = "ssh-remote"
			vi.mocked(vscode.env).uiKind = vscode.UIKind.Desktop

			const result = canReadLocalKeybindings()

			expect(result).toBe(false)
		})

		it("should return false for web environment", () => {
			vi.mocked(vscode.env).remoteName = undefined
			vi.mocked(vscode.env).uiKind = vscode.UIKind.Web

			const result = canReadLocalKeybindings()

			expect(result).toBe(false)
		})
	})

	describe("readUserKeybindings", () => {
		it("should return empty array for remote environment", async () => {
			vi.mocked(vscode.env).remoteName = "ssh-remote"

			const result = await readUserKeybindings()

			expect(result).toEqual([])
		})

		it("should handle VS Code standard installation", async () => {
			vi.mocked(vscode.env).appName = "Visual Studio Code"
			vi.mocked(fs.readdir).mockRejectedValue(new Error("No profiles"))
			vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true, mtimeMs: Date.now() } as any)
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				Buffer.from(JSON.stringify([{ key: "cmd+i", command: "test.command" }]), "utf8"),
			)

			const result = await readUserKeybindings()

			expect(result).toEqual([{ key: "cmd+i", command: "test.command" }])
		})

		it("should handle VSCodium installation", async () => {
			vi.mocked(vscode.env).appName = "VSCodium"
			vi.mocked(fs.readdir).mockRejectedValue(new Error("No profiles"))
			vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true, mtimeMs: Date.now() } as any)
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				Buffer.from(
					JSON.stringify([{ key: "ctrl+shift+p", command: "workbench.action.showCommands" }]),
					"utf8",
				),
			)

			const result = await readUserKeybindings()

			expect(result).toEqual([{ key: "ctrl+shift+p", command: "workbench.action.showCommands" }])
		})

		it("should handle Cursor installation", async () => {
			vi.mocked(vscode.env).appName = "Cursor"
			vi.mocked(fs.readdir).mockRejectedValue(new Error("No profiles"))
			vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true, mtimeMs: Date.now() } as any)
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				Buffer.from(JSON.stringify([{ key: "cmd+k", command: "cursor.command" }]), "utf8"),
			)

			const result = await readUserKeybindings()

			expect(result).toEqual([{ key: "cmd+k", command: "cursor.command" }])
		})

		it("should handle Windsurf installation", async () => {
			vi.mocked(vscode.env).appName = "Windsurf"
			vi.mocked(fs.readdir).mockRejectedValue(new Error("No profiles"))
			vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true, mtimeMs: Date.now() } as any)
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				Buffer.from(JSON.stringify([{ key: "cmd+w", command: "windsurf.command" }]), "utf8"),
			)

			const result = await readUserKeybindings()

			expect(result).toEqual([{ key: "cmd+w", command: "windsurf.command" }])
		})

		it("should handle portable installation", async () => {
			process.env.VSCODE_PORTABLE = "/portable/vscode"
			vi.mocked(fs.readdir).mockRejectedValue(new Error("No profiles"))
			vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true, mtimeMs: Date.now() } as any)
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				Buffer.from(JSON.stringify([{ key: "f1", command: "portable.command" }]), "utf8"),
			)

			const result = await readUserKeybindings()

			expect(result).toEqual([{ key: "f1", command: "portable.command" }])
		})

		it("should handle code-server environment", async () => {
			process.env.CODE_SERVER = "true"
			vi.mocked(fs.readdir).mockRejectedValue(new Error("No profiles"))
			vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true, mtimeMs: Date.now() } as any)
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
				Buffer.from(JSON.stringify([{ key: "ctrl+`", command: "terminal.new" }]), "utf8"),
			)

			const result = await readUserKeybindings()

			expect(result).toEqual([{ key: "ctrl+`", command: "terminal.new" }])
		})

		it("should handle profiles and prefer most recent", async () => {
			const mockProfiles = [
				{ name: "profile1", isDirectory: () => true },
				{ name: "profile2", isDirectory: () => true },
			]
			vi.mocked(fs.readdir).mockResolvedValue(mockProfiles as any)

			// Mock file stats with different modification times
			vi.mocked(fs.stat)
				.mockResolvedValueOnce({ isFile: () => true, mtimeMs: 1000 } as any) // main keybindings.json
				.mockResolvedValueOnce({ isFile: () => true, mtimeMs: 2000 } as any) // profile1
				.mockResolvedValueOnce({ isFile: () => true, mtimeMs: 3000 } as any) // profile2 (most recent)

			// Mock file reads - profile2 should be read first due to sorting
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(
				Buffer.from(JSON.stringify([{ key: "cmd+p", command: "profile2.command" }]), "utf8"),
			)

			const result = await readUserKeybindings()

			expect(result).toEqual([{ key: "cmd+p", command: "profile2.command" }])
		})

		it("should return empty array when no keybindings files exist", async () => {
			vi.mocked(fs.readdir).mockRejectedValue(new Error("No profiles"))
			vi.mocked(fs.stat).mockRejectedValue(new Error("File not found"))

			const result = await readUserKeybindings()

			expect(result).toEqual([])
		})
	})

	describe("readJSON5File", () => {
		it("should parse valid JSON5 with comments", async () => {
			const json5Content = `[
				// This is a comment
				{
					"key": "cmd+i",
					"command": "test.command"
				},
				/* Multi-line comment */
				{
					"key": "f1",
					"command": "another.command",
				}
			]`
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(json5Content, "utf8"))

			const result = await readJSON5File("/test/path")

			expect(result).toEqual([
				{ key: "cmd+i", command: "test.command" },
				{ key: "f1", command: "another.command" },
			])
		})

		it("should return null for invalid JSON", async () => {
			vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from("invalid json", "utf8"))

			const result = await readJSON5File("/test/path")

			expect(result).toBeNull()
		})

		it("should return null when file cannot be read", async () => {
			vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("File not found"))

			const result = await readJSON5File("/test/path")

			expect(result).toBeNull()
		})
	})

	describe("getUserKeybindingsDirForDiagnostics", () => {
		it("should return user directory path for desktop environment", async () => {
			vi.mocked(vscode.env).remoteName = undefined
			vi.mocked(vscode.env).uiKind = vscode.UIKind.Desktop

			const result = await getUserKeybindingsDirForDiagnostics()

			expect(result).toContain("User")
		})

		it("should return undefined for remote environment", async () => {
			vi.mocked(vscode.env).remoteName = "ssh-remote"

			const result = await getUserKeybindingsDirForDiagnostics()

			expect(result).toBeUndefined()
		})
	})

	describe("getDefaultKeybindings", () => {
		it("should return keybindings from package.json", () => {
			const mockContext = {
				extension: {
					packageJSON: {
						contributes: {
							keybindings: [
								{ key: "cmd+i", command: "test.command" },
								{ key: "ctrl+shift+g", command: "another.command" },
							],
						},
					},
				},
			} as any

			const result = getDefaultKeybindings(mockContext)

			expect(result).toEqual([
				{ key: "cmd+i", command: "test.command" },
				{ key: "ctrl+shift+g", command: "another.command" },
			])
		})

		it("should return empty array when no keybindings in package.json", () => {
			const mockContext = {
				extension: {
					packageJSON: {
						contributes: {},
					},
				},
			} as any

			const result = getDefaultKeybindings(mockContext)

			expect(result).toEqual([])
		})
	})

	describe("platform-specific paths", () => {
		it("should use correct paths on macOS", async () => {
			Object.defineProperty(process, "platform", {
				value: "darwin",
				configurable: true,
			})
			process.env.HOME = "/Users/test"
			vi.mocked(vscode.env).appName = "Visual Studio Code"
			vi.mocked(os.homedir).mockReturnValue("/Users/test")

			const result = await getUserKeybindingsDirForDiagnostics()

			expect(result).toBe("/Users/test/Library/Application Support/Code/User")
		})

		it("should use correct paths on Linux", async () => {
			Object.defineProperty(process, "platform", {
				value: "linux",
				configurable: true,
			})
			process.env.HOME = "/home/test"
			vi.mocked(vscode.env).appName = "Visual Studio Code"
			vi.mocked(os.homedir).mockReturnValue("/home/test")

			const result = await getUserKeybindingsDirForDiagnostics()

			expect(result).toBe("/home/test/.config/Code/User")
		})

		it("should respect XDG_CONFIG_HOME on Linux", async () => {
			Object.defineProperty(process, "platform", {
				value: "linux",
				configurable: true,
			})
			process.env.XDG_CONFIG_HOME = "/custom/config"
			vi.mocked(vscode.env).appName = "Visual Studio Code"
			vi.mocked(os.homedir).mockReturnValue("/home/test")

			const result = await getUserKeybindingsDirForDiagnostics()

			expect(result).toBe("/custom/config/Code/User")
		})
	})
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import {
	getCurrentKeybindingLabel,
	getKeybindingLabels,
	getPlatformKeybinding,
	getPlatformModifier,
} from "./keybindings"
import * as vscodeConfig from "./vscode-config"

// Mock VS Code API
vi.mock("vscode", () => ({
	workspace: {
		fs: {
			readFile: vi.fn(),
		},
	},
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
	},
}))

// Mock vscode-config module
vi.mock("./vscode-config", () => ({
	readUserKeybindings: vi.fn(),
	getDefaultKeybindings: vi.fn(),
}))

// Mock process.platform and process.env
const originalPlatform = process.platform
const originalEnv = process.env

describe("keybindings utilities", () => {
	const mockContext = {
		extension: {
			packageJSON: {
				contributes: {
					keybindings: [
						{
							key: "cmd+i",
							command: "kilo-code.ghost.promptCodeSuggestion",
						},
						{
							key: "ctrl+shift+g",
							command: "kilo-code.ghost.generateSuggestions",
						},
					],
				},
			},
		},
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset platform and env
		Object.defineProperty(process, "platform", {
			value: "darwin",
			configurable: true,
		})
		process.env = { ...originalEnv, HOME: "/mock/home" }

		// Setup default mocks
		vi.mocked(vscodeConfig.readUserKeybindings).mockResolvedValue([])
		vi.mocked(vscodeConfig.getDefaultKeybindings).mockReturnValue(
			mockContext.extension.packageJSON.contributes.keybindings,
		)
	})

	afterEach(() => {
		// Restore original values
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			configurable: true,
		})
		process.env = originalEnv
	})

	describe("getCurrentKeybindingLabel", () => {
		it("should return formatted keybinding from user keybindings.json", async () => {
			const mockUserKeybindings = [
				{
					key: "cmd+shift+i",
					command: "kilo-code.ghost.promptCodeSuggestion",
				},
			]

			vi.mocked(vscodeConfig.readUserKeybindings).mockResolvedValue(mockUserKeybindings)

			const result = await getCurrentKeybindingLabel("kilo-code.ghost.promptCodeSuggestion", mockContext)

			expect(result).toBe("Cmd+Shift+I")
		})

		it("should fallback to package.json default when no user override", async () => {
			// Mock empty user keybindings
			vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("File not found"))

			const result = await getCurrentKeybindingLabel("kilo-code.ghost.promptCodeSuggestion", mockContext)

			expect(result).toBe("Cmd+I")
		})

		it("should handle platform-specific formatting on Windows", async () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
				configurable: true,
			})

			vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("File not found"))

			const result = await getCurrentKeybindingLabel("kilo-code.ghost.promptCodeSuggestion", mockContext)

			expect(result).toBe("Ctrl+I")
		})

		it("should handle platform-specific formatting on Linux", async () => {
			Object.defineProperty(process, "platform", {
				value: "linux",
				configurable: true,
			})

			vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("File not found"))

			const result = await getCurrentKeybindingLabel("kilo-code.ghost.promptCodeSuggestion", mockContext)

			expect(result).toBe("Ctrl+I")
		})

		it("should return undefined for unknown commands", async () => {
			vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("File not found"))

			const result = await getCurrentKeybindingLabel("unknown.command", mockContext)

			expect(result).toBeUndefined()
		})

		it("should handle JSON5 comments in keybindings file", async () => {
			const mockUserKeybindings = [
				{
					key: "cmd+shift+i",
					command: "kilo-code.ghost.promptCodeSuggestion",
				},
				{
					key: "f1",
					command: "workbench.action.showCommands",
				},
			]

			vi.mocked(vscodeConfig.readUserKeybindings).mockResolvedValue(mockUserKeybindings)

			const result = await getCurrentKeybindingLabel("kilo-code.ghost.promptCodeSuggestion", mockContext)

			expect(result).toBe("Cmd+Shift+I")
		})

		it("should handle chord keybindings", async () => {
			const mockUserKeybindings = [
				{
					key: "ctrl+k ctrl+s",
					command: "workbench.action.openSettings",
				},
			]

			const contextWithChord = {
				extension: {
					packageJSON: {
						contributes: {
							keybindings: [
								{
									key: "ctrl+k ctrl+s",
									command: "workbench.action.openSettings",
								},
							],
						},
					},
				},
			} as any

			vi.mocked(vscodeConfig.readUserKeybindings).mockResolvedValue(mockUserKeybindings)
			vi.mocked(vscodeConfig.getDefaultKeybindings).mockReturnValue(
				contextWithChord.extension.packageJSON.contributes.keybindings,
			)

			const result = await getCurrentKeybindingLabel("workbench.action.openSettings", contextWithChord)

			expect(result).toBe("Ctrl+K, Ctrl+S")
		})
	})

	describe("getKeybindingLabels", () => {
		it("should return keybinding labels for multiple commands", async () => {
			vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("File not found"))

			const result = await getKeybindingLabels(
				["kilo-code.ghost.promptCodeSuggestion", "kilo-code.ghost.generateSuggestions"],
				mockContext,
			)

			expect(result).toEqual({
				"kilo-code.ghost.promptCodeSuggestion": "Cmd+I",
				"kilo-code.ghost.generateSuggestions": "Ctrl+Shift+G",
			})
		})

		it("should handle empty command list", async () => {
			const result = await getKeybindingLabels([], mockContext)

			expect(result).toEqual({})
		})

		it("should handle mix of found and unknown commands", async () => {
			vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("File not found"))

			const result = await getKeybindingLabels(
				["kilo-code.ghost.promptCodeSuggestion", "unknown.command"],
				mockContext,
			)

			expect(result).toEqual({
				"kilo-code.ghost.promptCodeSuggestion": "Cmd+I",
				"unknown.command": undefined,
			})
		})
	})

	describe("getPlatformKeybinding", () => {
		it("should format keybinding for macOS", () => {
			Object.defineProperty(process, "platform", {
				value: "darwin",
				configurable: true,
			})

			const result = getPlatformKeybinding("ctrl+shift+g")

			expect(result).toBe("Ctrl+Shift+G")
		})

		it("should format keybinding for Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
				configurable: true,
			})

			const result = getPlatformKeybinding("ctrl+shift+g")

			expect(result).toBe("Ctrl+Shift+G")
		})

		it("should format keybinding for Linux", () => {
			Object.defineProperty(process, "platform", {
				value: "linux",
				configurable: true,
			})

			const result = getPlatformKeybinding("ctrl+shift+g")

			expect(result).toBe("Ctrl+Shift+G")
		})

		it("should handle cmd key on different platforms", () => {
			Object.defineProperty(process, "platform", {
				value: "darwin",
				configurable: true,
			})
			expect(getPlatformKeybinding("cmd+i")).toBe("Cmd+I")

			Object.defineProperty(process, "platform", {
				value: "win32",
				configurable: true,
			})
			expect(getPlatformKeybinding("cmd+i")).toBe("Ctrl+I")
		})

		it("should handle chord keybindings in getPlatformKeybinding", () => {
			Object.defineProperty(process, "platform", {
				value: "darwin",
				configurable: true,
			})
			expect(getPlatformKeybinding("ctrl+k ctrl+s")).toBe("Ctrl+K, Ctrl+S")

			Object.defineProperty(process, "platform", {
				value: "win32",
				configurable: true,
			})
			expect(getPlatformKeybinding("ctrl+k ctrl+s")).toBe("Ctrl+K, Ctrl+S")
		})
	})

	describe("getPlatformModifier", () => {
		it("should return Cmd for macOS", () => {
			Object.defineProperty(process, "platform", {
				value: "darwin",
				configurable: true,
			})

			const result = getPlatformModifier()

			expect(result).toBe("Cmd")
		})

		it("should return Ctrl for Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
				configurable: true,
			})

			const result = getPlatformModifier()

			expect(result).toBe("Ctrl")
		})

		it("should return Ctrl for Linux", () => {
			Object.defineProperty(process, "platform", {
				value: "linux",
				configurable: true,
			})

			const result = getPlatformModifier()

			expect(result).toBe("Ctrl")
		})
	})
})

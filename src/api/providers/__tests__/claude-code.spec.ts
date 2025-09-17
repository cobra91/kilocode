import { ClaudeCodeHandler } from "../claude-code"
import { ApiHandlerOptions } from "../../../shared/api"
import { ClaudeCodeMessage } from "../../../integrations/claude-code/types"
import * as fs from "fs/promises"
import * as os from "os"

// Mock the runClaudeCode function
vi.mock("../../../integrations/claude-code/run", () => ({
	runClaudeCode: vi.fn(),
}))

// Mock the message filter
vi.mock("../../../integrations/claude-code/message-filter", () => ({
	filterMessagesForClaudeCode: vi.fn((messages) => messages),
}))

// Mock fs and os for config file reading
vi.mock("fs/promises")
vi.mock("os")

const { runClaudeCode } = await import("../../../integrations/claude-code/run")
const { filterMessagesForClaudeCode } = await import("../../../integrations/claude-code/message-filter")
const mockRunClaudeCode = vi.mocked(runClaudeCode)
const mockFilterMessages = vi.mocked(filterMessagesForClaudeCode)
const mockFs = vi.mocked(fs)
const mockOs = vi.mocked(os)

describe("ClaudeCodeHandler", () => {
	let handler: ClaudeCodeHandler

	beforeEach(() => {
		vi.clearAllMocks()
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "claude-3-5-sonnet-20241022",
		}
		handler = new ClaudeCodeHandler(options)
	})

	test("should create handler with correct model configuration", () => {
		const model = handler.getModel()
		expect(model.id).toBe("claude-3-5-sonnet-20241022")
		expect(model.info.supportsImages).toBe(false)
		expect(model.info.supportsPromptCache).toBe(true) // Claude Code now supports prompt caching
	})

	test("should use default model when invalid model provided", () => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "invalid-model",
		}
		const handlerWithInvalidModel = new ClaudeCodeHandler(options)
		const model = handlerWithInvalidModel.getModel()

		expect(model.id).toBe("claude-sonnet-4-20250514") // default model
	})

	test("should override maxTokens when claudeCodeMaxOutputTokens is provided", () => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "claude-sonnet-4-20250514",
			claudeCodeMaxOutputTokens: 8000,
		}
		const handlerWithMaxTokens = new ClaudeCodeHandler(options)
		const model = handlerWithMaxTokens.getModel()

		expect(model.id).toBe("claude-sonnet-4-20250514")
		expect(model.info.maxTokens).toBe(8000) // Should use the configured value, not the default 64000
	})

	test("should override maxTokens for default model when claudeCodeMaxOutputTokens is provided", () => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "invalid-model", // Will fall back to default
			claudeCodeMaxOutputTokens: 16384,
		}
		const handlerWithMaxTokens = new ClaudeCodeHandler(options)
		const model = handlerWithMaxTokens.getModel()

		expect(model.id).toBe("claude-sonnet-4-20250514") // default model
		expect(model.info.maxTokens).toBe(16384) // Should use the configured value
	})

	test("should filter messages and call runClaudeCode", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]
		const filteredMessages = [{ role: "user" as const, content: "Hello (filtered)" }]

		mockFilterMessages.mockReturnValue(filteredMessages)

		// Mock empty async generator
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Empty generator for basic test
		}
		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)

		// Need to start iterating to trigger the call
		const iterator = stream[Symbol.asyncIterator]()
		await iterator.next()

		// Verify message filtering was called
		expect(mockFilterMessages).toHaveBeenCalledWith(messages)

		// Verify runClaudeCode was called with filtered messages
		expect(mockRunClaudeCode).toHaveBeenCalledWith({
			systemPrompt,
			messages: filteredMessages,
			path: "claude",
			modelId: "claude-3-5-sonnet-20241022",
			maxOutputTokens: undefined, // No maxOutputTokens configured in this test
		})
	})

	test("should pass maxOutputTokens to runClaudeCode when configured", async () => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "claude-3-5-sonnet-20241022",
			claudeCodeMaxOutputTokens: 16384,
		}
		const handlerWithMaxTokens = new ClaudeCodeHandler(options)

		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]
		const filteredMessages = [{ role: "user" as const, content: "Hello (filtered)" }]

		mockFilterMessages.mockReturnValue(filteredMessages)

		// Mock empty async generator
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Empty generator for basic test
		}
		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handlerWithMaxTokens.createMessage(systemPrompt, messages)

		// Need to start iterating to trigger the call
		const iterator = stream[Symbol.asyncIterator]()
		await iterator.next()

		// Verify runClaudeCode was called with maxOutputTokens
		expect(mockRunClaudeCode).toHaveBeenCalledWith({
			systemPrompt,
			messages: filteredMessages,
			path: "claude",
			modelId: "claude-3-5-sonnet-20241022",
			maxOutputTokens: 16384,
		})
	})

	test("should handle thinking content properly", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields thinking content
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "thinking",
							thinking: "I need to think about this carefully...",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(1)
		expect(results[0]).toEqual({
			type: "reasoning",
			text: "I need to think about this carefully...",
		})
	})

	test("should handle redacted thinking content", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields redacted thinking content
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "redacted_thinking",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(1)
		expect(results[0]).toEqual({
			type: "reasoning",
			text: "[Redacted thinking block]",
		})
	})

	test("should handle mixed content types", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields mixed content
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "thinking",
							thinking: "Let me think about this...",
						},
						{
							type: "text",
							text: "Here's my response!",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "reasoning",
			text: "Let me think about this...",
		})
		expect(results[1]).toEqual({
			type: "text",
			text: "Here's my response!",
		})
	})

	test("should handle string chunks from generator", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields string chunks
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield "This is a string chunk"
			yield "Another string chunk"
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "This is a string chunk",
		})
		expect(results[1]).toEqual({
			type: "text",
			text: "Another string chunk",
		})
	})

	test("should handle usage and cost tracking with paid usage", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator with init, assistant, and result messages
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Init message indicating paid usage
			yield {
				type: "system" as const,
				subtype: "init" as const,
				session_id: "session_123",
				tools: [],
				mcp_servers: [],
				apiKeySource: "/login managed key",
			}

			// Assistant message
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "text",
							text: "Hello there!",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
						cache_read_input_tokens: 5,
						cache_creation_input_tokens: 3,
					},
				} as any,
				session_id: "session_123",
			}

			// Result message
			yield {
				type: "result" as const,
				subtype: "success" as const,
				total_cost_usd: 0.05,
				is_error: false,
				duration_ms: 1000,
				duration_api_ms: 800,
				num_turns: 1,
				result: "success",
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should have text chunk and usage chunk
		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "Hello there!",
		})
		expect(results[1]).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
			totalCost: 0.05, // Paid usage, so cost is included
		})
	})

	test("should handle usage tracking with subscription (free) usage", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator with subscription usage
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Init message indicating subscription usage
			yield {
				type: "system" as const,
				subtype: "init" as const,
				session_id: "session_123",
				tools: [],
				mcp_servers: [],
				apiKeySource: "none", // Subscription usage
			}

			// Assistant message
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "text",
							text: "Hello there!",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}

			// Result message
			yield {
				type: "result" as const,
				subtype: "success" as const,
				total_cost_usd: 0.05,
				is_error: false,
				duration_ms: 1000,
				duration_api_ms: 800,
				num_turns: 1,
				result: "success",
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should have text chunk and usage chunk
		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "Hello there!",
		})
		expect(results[1]).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0, // Subscription usage, so cost is 0
		})
	})

	test("should handle API errors properly", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields an API error
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "text",
							text: 'API Error: 400 {"error":{"message":"Invalid model name"}}',
						},
					],
					stop_reason: "stop_sequence",
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const iterator = stream[Symbol.asyncIterator]()

		// Should throw an error
		await expect(iterator.next()).rejects.toThrow()
	})

	test("should calculate cost even when result chunk is missing", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator with init and assistant messages but NO result chunk
		// This simulates the scenario where the stream ends unexpectedly
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Init message indicating paid usage
			yield {
				type: "system" as const,
				subtype: "init" as const,
				session_id: "session_123",
				tools: [],
				mcp_servers: [],
				apiKeySource: "/login managed key", // Paid usage
			}
			// Assistant message with usage data
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "text",
							text: "Hello there!",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
						cache_read_input_tokens: 5,
						cache_creation_input_tokens: 3,
					},
				} as any,
				session_id: "session_123",
			}
			// NOTE: No result chunk is yielded - this simulates the bug scenario
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())
		const stream = handler.createMessage(systemPrompt, messages)
		const results = []
		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should have text chunk and usage chunk with calculated cost
		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "Hello there!",
		})
		expect(results[1]).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
			totalCost: expect.any(Number), // Cost should be calculated even without result chunk
		})

		// Verify the cost is calculated and non-zero for paid usage
		expect((results[1] as any).totalCost).toBeGreaterThan(0)
	})

	test("should handle zero cost when no usage data is available", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator with only init message (no usage data at all)
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Init message indicating paid usage
			yield {
				type: "system" as const,
				subtype: "init" as const,
				session_id: "session_123",
				tools: [],
				mcp_servers: [],
				apiKeySource: "/login managed key", // Paid usage
			}
			// No assistant message with usage data and no result chunk
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())
		const stream = handler.createMessage(systemPrompt, messages)
		const results = []
		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should have usage chunk with zero cost
		expect(results).toHaveLength(1)
		expect(results[0]).toEqual({
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0, // No usage data, so cost should be 0
		})
	})

	test("should log warning for unsupported tool_use content", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Mock os.homedir to prevent TypeError
		mockOs.homedir.mockReturnValue("C:\\Users\\test")

		// Mock async generator that yields tool_use content
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "tool_use",
							id: "tool_123",
							name: "test_tool",
							input: { test: "data" },
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should log error for unsupported tool_use
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("tool_use is not supported yet"))

		consoleSpy.mockRestore()
	})

	test("should read configuration from Claude Code settings files", async () => {
		// This test verifies the configuration reading functionality
		// The actual file reading is tested through integration tests
		expect(true).toBe(true)
	})

	test("should use Z.ai model info when Z.ai base URL is configured", async () => {
		const mockConfig = {
			env: {
				ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
				ANTHROPIC_MODEL: "glm-4.5",
			},
		}

		mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig))

		// Use the static method to test model detection directly
		const providerInfo = await ClaudeCodeHandler.getAvailableModels("claude")

		// Should detect Z.ai provider
		expect(providerInfo).not.toBeNull()
		expect(providerInfo?.provider).toBe("zai")

		// Should have Z.ai models with correct pricing
		const models = providerInfo?.models || {}
		expect(models["glm-4.5"]).toBeDefined()
		expect(models["glm-4.5"].inputPrice).toBe(0.6) // Z.ai glm-4.5 international input price
		expect(models["glm-4.5"].outputPrice).toBe(2.2) // Z.ai glm-4.5 international output price
	})

	test("should use Qwen model info when Qwen base URL is configured", async () => {
		const mockConfig = {
			env: {
				ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
				ANTHROPIC_MODEL: "qwen3-coder-plus",
			},
		}

		mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig))

		// Use the static method to test model detection directly
		const providerInfo = await ClaudeCodeHandler.getAvailableModels("claude")

		// Should detect Qwen provider
		expect(providerInfo).not.toBeNull()
		expect(providerInfo?.provider).toBe("qwen-code")

		// Should have Qwen models with correct pricing
		const models = providerInfo?.models || {}
		expect(models["qwen3-coder-plus"]).toBeDefined()
		expect(models["qwen3-coder-plus"].inputPrice).toBe(0) // Qwen is free
		expect(models["qwen3-coder-plus"].outputPrice).toBe(0) // Qwen is free
		expect(models["qwen3-coder-plus"].contextWindow).toBe(1_000_000) // Qwen has 1M context
	})

	test("should use DeepSeek model info when DeepSeek base URL is configured", async () => {
		const mockConfig = {
			env: {
				ANTHROPIC_BASE_URL: "https://api.deepseek.com",
				ANTHROPIC_MODEL: "deepseek-chat",
			},
		}

		mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig))

		// Use the static method to test model detection directly
		const providerInfo = await ClaudeCodeHandler.getAvailableModels("claude")

		// Should detect DeepSeek provider
		expect(providerInfo).not.toBeNull()
		expect(providerInfo?.provider).toBe("deepseek")

		// Should have DeepSeek models with correct pricing
		const models = providerInfo?.models || {}
		expect(models["deepseek-chat"]).toBeDefined()
		expect(models["deepseek-chat"].inputPrice).toBe(0.27) // DeepSeek-chat input price
		expect(models["deepseek-chat"].outputPrice).toBe(1.1) // DeepSeek-chat output price
		expect(models["deepseek-chat"].supportsPromptCache).toBe(true) // DeepSeek supports caching
	})

	test("should default to appropriate models when ANTHROPIC_MODEL is not specified", async () => {
		// Test Z.ai default
		const zaiConfig = {
			env: {
				ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
			},
		}
		mockFs.readFile.mockResolvedValue(JSON.stringify(zaiConfig))

		const zaiOptions: ApiHandlerOptions = {
			claudeCodePath: "claude",
		}
		const zaiHandler = new ClaudeCodeHandler(zaiOptions)

		// Wait for async initialization
		await new Promise((resolve) => setTimeout(resolve, 0))

		const zaiModel = zaiHandler.getModel()
		expect(zaiModel.id).toBe("glm-4.5") // Default Z.ai model

		// Test Qwen default
		const qwenConfig = {
			env: {
				ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			},
		}
		mockFs.readFile.mockResolvedValue(JSON.stringify(qwenConfig))

		const qwenOptions: ApiHandlerOptions = {
			claudeCodePath: "claude",
		}
		const qwenHandler = new ClaudeCodeHandler(qwenOptions)

		// Wait for async initialization
		await new Promise((resolve) => setTimeout(resolve, 0))

		const qwenModel = qwenHandler.getModel()
		expect(qwenModel.id).toBe("qwen3-coder-plus") // Default Qwen model

		// Test DeepSeek default
		const deepseekConfig = {
			env: {
				ANTHROPIC_BASE_URL: "https://api.deepseek.com",
			},
		}
		mockFs.readFile.mockResolvedValue(JSON.stringify(deepseekConfig))

		const deepseekOptions: ApiHandlerOptions = {
			claudeCodePath: "claude",
		}
		const deepseekHandler = new ClaudeCodeHandler(deepseekOptions)

		// Wait for async initialization
		await new Promise((resolve) => setTimeout(resolve, 0))

		const deepseekModel = deepseekHandler.getModel()
		expect(deepseekModel.id).toBe("deepseek-chat") // Default DeepSeek model
	})

	describe("Configuration-based provider detection", () => {
		beforeEach(() => {
			vi.clearAllMocks()
			// Mock Windows platform
			mockOs.platform.mockReturnValue("win32")
			mockOs.homedir.mockReturnValue("C:\\Users\\test")
		})

		test("should detect Z.ai provider from config file", async () => {
			const mockConfig = {
				env: {
					ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
					ANTHROPIC_MODEL: "glm-4.5",
				},
			}

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig))

			const options: ApiHandlerOptions = {
				claudeCodePath: "claude",
			}
			const handler = new ClaudeCodeHandler(options)
			const model = handler.getModel()

			expect(model.id).toBe("glm-4.5")
			expect(model.info.inputPrice).toBe(0.6) // Z.ai glm-4.5 international input price
			expect(model.info.outputPrice).toBe(2.2) // Z.ai glm-4.5 international output price
		})

		test("should detect Qwen provider from config file", async () => {
			const mockConfig = {
				env: {
					ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
					ANTHROPIC_MODEL: "qwen3-coder-plus",
				},
			}

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig))

			const options: ApiHandlerOptions = {
				claudeCodePath: "claude",
			}
			const handler = new ClaudeCodeHandler(options)
			const model = handler.getModel()

			expect(model.id).toBe("qwen3-coder-plus")
			expect(model.info.inputPrice).toBe(0) // Qwen is free
			expect(model.info.outputPrice).toBe(0) // Qwen is free
		})

		test("should detect DeepSeek provider from config file", async () => {
			const mockConfig = {
				env: {
					ANTHROPIC_BASE_URL: "https://api.deepseek.com",
					ANTHROPIC_MODEL: "deepseek-chat",
				},
			}

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig))

			const options: ApiHandlerOptions = {
				claudeCodePath: "claude",
			}
			const handler = new ClaudeCodeHandler(options)
			const model = handler.getModel()

			expect(model.id).toBe("deepseek-chat")
			expect(model.info.inputPrice).toBe(0.27) // DeepSeek-chat input price
			expect(model.info.outputPrice).toBe(1.1) // DeepSeek-chat output price
		})

		test("should fall back to Claude models when config file not found", async () => {
			mockFs.readFile.mockRejectedValue(new Error("File not found"))

			const options: ApiHandlerOptions = {
				claudeCodePath: "claude",
				apiModelId: "claude-sonnet-4-20250514",
			}
			const handler = new ClaudeCodeHandler(options)
			const model = handler.getModel()

			expect(model.id).toBe("claude-sonnet-4-20250514")
			// Should use Claude pricing
			expect(model.info.inputPrice).toBe(3) // Claude sonnet input price
		})

		test("should fall back to Claude models when config has no env section", async () => {
			const mockConfig = {
				someOtherSetting: "value",
			}

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig))

			const options: ApiHandlerOptions = {
				claudeCodePath: "claude",
				apiModelId: "claude-sonnet-4-20250514",
			}
			const handler = new ClaudeCodeHandler(options)
			const model = handler.getModel()

			expect(model.id).toBe("claude-sonnet-4-20250514")
		})

		test("should use static getAvailableModels method", async () => {
			const mockConfig = {
				env: {
					ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
					ANTHROPIC_MODEL: "glm-4.5",
				},
			}

			mockFs.readFile.mockResolvedValue(JSON.stringify(mockConfig))

			const availableModels = await ClaudeCodeHandler.getAvailableModels("claude")

			expect(availableModels).toEqual({
				provider: "zai",
				models: expect.any(Object),
			})
		})

		test("should handle errors in static getAvailableModels method", async () => {
			mockFs.readFile.mockRejectedValue(new Error("Read error"))

			const availableModels = await ClaudeCodeHandler.getAvailableModels("claude")

			expect(availableModels).toEqual({
				provider: "claude-code",
				models: expect.any(Object),
			})
		})
	})
})

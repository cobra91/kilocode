import { useState, useEffect } from "react"
import { vscode } from "@src/utils/vscode"

/**
 * Hook to get current keybindings for specific commands
 */
export function useKeybindings(commandIds: string[]): Record<string, string> {
	const [keybindings, setKeybindings] = useState<Record<string, string>>({})

	useEffect(() => {
		// Request keybindings from the extension
		vscode.postMessage({
			type: "getKeybindings",
			commandIds,
		})

		// Listen for the response
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "keybindings") {
				setKeybindings(message.keybindings || {})
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [commandIds])

	return keybindings
}

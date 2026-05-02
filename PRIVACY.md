# Zalo Scheduler Privacy Policy

Effective date: May 3, 2026

Zalo Scheduler is a Chrome extension for scheduling messages on Zalo Web at `https://chat.zalo.me/`.

## Data the extension handles

The extension may handle the following data only to provide its scheduling feature:

- Conversation names captured from the active Zalo Web tab when the user asks the extension to capture the current conversation.
- Message text, preset labels, scheduled times, status logs, and error logs created by the user inside the extension.
- Page content and interface state on `https://chat.zalo.me/` needed to find the selected conversation, detect the message composer, attach preset images when configured, and send the scheduled message.

## How data is stored

Zalo Scheduler stores schedules, preset overrides, and execution logs locally in the user's browser with `chrome.storage.local`.

The extension does not operate a developer server, does not upload extension data to a developer server, and does not use third-party analytics.

## How data is used

The data is used only to:

- Create and manage scheduled Zalo Web messages.
- Reopen or focus a Zalo Web tab when a schedule is due.
- Insert the scheduled message content and optional preset image into the selected Zalo Web conversation.
- Show schedule status and logs to the user in the extension popup.

## Data sharing

Zalo Scheduler does not sell user data.

Zalo Scheduler does not transfer user data to third parties except when the user-created scheduled message is sent through Zalo Web as part of the extension's single purpose.

## Remote code

The extension does not use remote JavaScript or remote WebAssembly. All extension code is included in the extension package.

## Contact

For questions about this policy, use the support options provided on the Chrome Web Store listing or the GitHub repository for this project.

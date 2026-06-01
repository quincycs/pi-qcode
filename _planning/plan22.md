create a new setting in the settings UI.

1. Move "Saved at [filepath]" to the top of the settings page, below the titlebar.

2. Add a title "Command Options" just above "Manage # autocomplete options..."

3. Add a title "Provider Options" just below "Saved at [filepath]". Then I'd like a list of items to configure just like the autocomplete options. The only difference is that the value text input should be a single line and not allow multiline input. The first text input should be for the nickname. The second text input should be for the pi cli args.

The placeholder text for nickname should be "Provider nickname" and the placeholder for the pi cli args should be "--model openai/gpt-5.5"

---

How the new setting is used:

1. When session detail is opened and the session filepath is unknown (it's a draft new session), then a dropdown should be shown in the body of the page to allow the user to select a provider setting. If no provider settings are available then display text "Pi will start with default settings, but you can change what model Pi uses by creating a provider setting in the settings page."

2. When a provider setting is selected from the dropdown, the provider cliArgs are passed into the pi command line args when the message is sent.

3. after the message is sent, the provider dropdown or placeholder text should be removed from the UI.

---

When this provider dropdown is selected, I'd like a new setting to be saved to represent the last used provider. This setting will be used to pre-select the provider dropdown in the future rather than it always being on "Default Pi Settings". This setting should not be visible in the settings UI, but it should be considered in the save of the settings file so that it doesn't get lost unintentionally.
